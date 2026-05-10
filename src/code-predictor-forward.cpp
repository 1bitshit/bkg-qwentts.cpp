// code-predictor-forward.cpp : eager full-recompute graph for the
// Qwen3-TTS code predictor (5-layer Qwen3 stack with plain 1D NEOX
// RoPE, GQA attention with QK-norm, SwiGLU MLP, head-per-codebook
// output projection).
//
// The predictor architecture mirrors the Talker block, the only
// differences are :
//   - 5 layers instead of 28
//   - plain 1D RoPE (no multimodal sections)
//   - one private embedding table and one private linear head per
//     acoustic codebook (1..15)
//
// The single-frame loop here recomputes the full graph at every step g
// (0..14) over a sequence of length g+2. With 5 layers and at most 16
// tokens per recompute this is sub-millisecond on modern GPUs.

#include "code-predictor-forward.h"

#include "debug.h"
#include "ggml-alloc.h"
#include "ggml-backend.h"
#include "ggml.h"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

// One Qwen3 decoder block, identical structural pattern to the Talker
// layer, just with plain 1D RoPE on the position axis. Returns the
// layer output [hidden, T].
static struct ggml_tensor * code_predictor_layer_forward(struct ggml_context *        ctx,
                                                         const CodePredictorWeights * cw,
                                                         const TalkerLayer &          layer,
                                                         struct ggml_tensor *         x,
                                                         struct ggml_tensor *         positions,
                                                         struct ggml_tensor *         mask,
                                                         int                          T) {
    const int   n_q_heads = cw->num_attention_heads;
    const int   n_kv      = cw->num_key_value_heads;
    const int   hd        = cw->head_dim;
    const float eps       = cw->rms_norm_eps;

    struct ggml_tensor * h = ggml_rms_norm(ctx, x, eps);
    h                      = ggml_mul(ctx, h, layer.input_norm_w);

    struct ggml_tensor * q = ggml_mul_mat(ctx, layer.attn.q_proj_w, h);
    struct ggml_tensor * k = ggml_mul_mat(ctx, layer.attn.k_proj_w, h);
    struct ggml_tensor * v = ggml_mul_mat(ctx, layer.attn.v_proj_w, h);

    q = ggml_reshape_3d(ctx, q, hd, n_q_heads, T);
    k = ggml_reshape_3d(ctx, k, hd, n_kv, T);
    v = ggml_reshape_3d(ctx, v, hd, n_kv, T);

    q = ggml_rms_norm(ctx, q, eps);
    q = ggml_mul(ctx, q, layer.attn.q_norm_w);
    k = ggml_rms_norm(ctx, k, eps);
    k = ggml_mul(ctx, k, layer.attn.k_norm_w);

    q = ggml_rope_ext(ctx, q, positions, NULL, hd, GGML_ROPE_TYPE_NEOX, 0, cw->rope_theta, 1.0f, 0.0f, 1.0f, 0.0f,
                      0.0f);
    k = ggml_rope_ext(ctx, k, positions, NULL, hd, GGML_ROPE_TYPE_NEOX, 0, cw->rope_theta, 1.0f, 0.0f, 1.0f, 0.0f,
                      0.0f);

    struct ggml_tensor * q_p = ggml_cont(ctx, ggml_permute(ctx, q, 0, 2, 1, 3));
    struct ggml_tensor * k_p = ggml_cont(ctx, ggml_permute(ctx, k, 0, 2, 1, 3));
    struct ggml_tensor * v_p = ggml_cont(ctx, ggml_permute(ctx, v, 1, 2, 0, 3));

    struct ggml_tensor * scores = ggml_mul_mat(ctx, k_p, q_p);
    ggml_mul_mat_set_prec(scores, GGML_PREC_F32);

    float scale = 1.0f / sqrtf((float) hd);
    scores      = ggml_soft_max_ext(ctx, scores, mask, scale, 0.0f);

    struct ggml_tensor * attn = ggml_mul_mat(ctx, v_p, scores);
    attn                      = ggml_cont(ctx, ggml_permute(ctx, attn, 0, 2, 1, 3));
    attn                      = ggml_reshape_2d(ctx, attn, n_q_heads * hd, T);

    struct ggml_tensor * o = ggml_mul_mat(ctx, layer.attn.o_proj_w, attn);
    x                      = ggml_add(ctx, x, o);

    struct ggml_tensor * h2 = ggml_rms_norm(ctx, x, eps);
    h2                      = ggml_mul(ctx, h2, layer.post_attn_norm_w);

    struct ggml_tensor * gate = ggml_mul_mat(ctx, layer.mlp.gate_proj_w, h2);
    struct ggml_tensor * up   = ggml_mul_mat(ctx, layer.mlp.up_proj_w, h2);
    gate                      = ggml_silu(ctx, gate);
    struct ggml_tensor * gu   = ggml_mul(ctx, gate, up);
    struct ggml_tensor * mlp  = ggml_mul_mat(ctx, layer.mlp.down_proj_w, gu);

    x = ggml_add(ctx, x, mlp);
    return x;
}

// Run one recompute pass for predictor step g, with sub_input of length
// T = g + 2 vectors flattened row-major as [T, hidden]. Fills logits_out
// with the output of lm_head[g_head] applied to the final-norm of the
// last position. Returns false on failure.
static bool code_predictor_recompute(const CodePredictorWeights * cw,
                                     ggml_backend_sched_t         sched,
                                     const float *                sub_input,
                                     int                          T,
                                     int                          talker_hidden,
                                     int                          g_head,
                                     std::vector<float> *         logits_out) {
    const int vocab    = cw->vocab_size;
    const int n_layers = cw->num_hidden_layers;

    const int    max_nodes   = 32 * n_layers + 64;
    const size_t arena_bytes = ggml_tensor_overhead() * max_nodes + ggml_graph_overhead_custom(max_nodes, false);

    struct ggml_init_params gp   = { arena_bytes, NULL, true };
    struct ggml_context *   gctx = ggml_init(gp);
    if (!gctx) {
        fprintf(stderr, "[CodePredictor] FATAL: ggml_init failed\n");
        return false;
    }

    // Input lives in talker_hidden because every entry of sub_input is a
    // talker-side hidden : either the talker last hidden state, or one of
    // the codec_embedding rows that are also talker-sized in the upstream
    // checkpoint. The mtp_proj node below brings them down to predictor
    // hidden when the variant has a non-Identity projection.
    struct ggml_tensor * x_in    = ggml_new_tensor_2d(gctx, GGML_TYPE_F32, talker_hidden, T);
    struct ggml_tensor * pos_in  = ggml_new_tensor_1d(gctx, GGML_TYPE_I32, T);
    struct ggml_tensor * mask_in = ggml_new_tensor_2d(gctx, GGML_TYPE_F32, T, T);
    ggml_set_name(x_in, "sub_input");
    ggml_set_name(pos_in, "positions");
    ggml_set_name(mask_in, "causal_mask");

    struct ggml_cgraph * gf = ggml_new_graph_custom(gctx, max_nodes, false);

    // small_to_mtp projection : Linear(talker_hidden -> hidden) with bias.
    // When mtp_proj is absent (Identity case) the input is already at the
    // predictor hidden dimension and we feed x_in straight to the layers.
    struct ggml_tensor * h = x_in;
    if (cw->mtp_proj_w) {
        h = ggml_mul_mat(gctx, cw->mtp_proj_w, h);
        if (cw->mtp_proj_b) {
            h = ggml_add(gctx, h, cw->mtp_proj_b);
        }
        ggml_set_name(h, "mtp_proj_out");
    }

    for (int l = 0; l < n_layers; l++) {
        h = code_predictor_layer_forward(gctx, cw, cw->layers[(size_t) l], h, pos_in, mask_in, T);
    }

    struct ggml_tensor * h_final = ggml_rms_norm(gctx, h, cw->rms_norm_eps);
    h_final                      = ggml_mul(gctx, h_final, cw->norm_w);

    struct ggml_tensor * logits = ggml_mul_mat(gctx, cw->lm_head[(size_t) g_head], h_final);
    ggml_set_name(logits, "logits");
    ggml_set_output(logits);
    ggml_build_forward_expand(gf, logits);

    if (!ggml_backend_sched_alloc_graph(sched, gf)) {
        fprintf(stderr, "[CodePredictor] FATAL: graph allocation failed\n");
        ggml_backend_sched_reset(sched);
        ggml_free(gctx);
        return false;
    }

    ggml_backend_tensor_set(x_in, sub_input, 0, (size_t) T * (size_t) talker_hidden * sizeof(float));

    {
        std::vector<int32_t> pos((size_t) T);
        for (int i = 0; i < T; i++) {
            pos[(size_t) i] = i;
        }
        ggml_backend_tensor_set(pos_in, pos.data(), 0, (size_t) T * sizeof(int32_t));
    }

    {
        std::vector<float> mask((size_t) T * (size_t) T, -INFINITY);
        for (int q = 0; q < T; q++) {
            for (int k = 0; k <= q; k++) {
                mask[(size_t) q * (size_t) T + (size_t) k] = 0.0f;
            }
        }
        ggml_backend_tensor_set(mask_in, mask.data(), 0, mask.size() * sizeof(float));
    }

    if (ggml_backend_sched_graph_compute(sched, gf) != GGML_STATUS_SUCCESS) {
        fprintf(stderr, "[CodePredictor] FATAL: graph compute failed\n");
        ggml_backend_sched_reset(sched);
        ggml_free(gctx);
        return false;
    }

    logits_out->resize((size_t) vocab);
    size_t row_bytes = (size_t) vocab * sizeof(float);
    ggml_backend_tensor_get(logits, logits_out->data(), (size_t) (T - 1) * row_bytes, row_bytes);

    ggml_backend_sched_reset(sched);
    ggml_free(gctx);
    return true;
}

// Read one row of an embedding table to f32. Reads from the backend
// (the predictor weights live there) via ggml_backend_tensor_get,
// dispatched through ggml_get_type_traits so quants are accepted.
static void embed_row_from_backend(struct ggml_tensor * t, int row_id, int dim, float * dst) {
    if (t->ne[0] != dim) {
        fprintf(stderr, "[CodePredictor] FATAL: embed dim mismatch %lld vs %d\n", (long long) t->ne[0], dim);
        std::exit(1);
    }
    if (row_id < 0 || row_id >= (int) t->ne[1]) {
        fprintf(stderr, "[CodePredictor] FATAL: row %d out of range (vocab=%lld)\n", row_id, (long long) t->ne[1]);
        std::exit(1);
    }
    const size_t row_bytes = ggml_row_size(t->type, dim);
    if (t->type == GGML_TYPE_F32) {
        ggml_backend_tensor_get(t, dst, (size_t) row_id * row_bytes, row_bytes);
        return;
    }
    const struct ggml_type_traits * tt = ggml_get_type_traits(t->type);
    if (!tt || !tt->to_float) {
        fprintf(stderr, "[CodePredictor] FATAL: unsupported embed dtype %d\n", (int) t->type);
        std::exit(1);
    }
    std::vector<uint8_t> tmp(row_bytes);
    ggml_backend_tensor_get(t, tmp.data(), (size_t) row_id * row_bytes, row_bytes);
    tt->to_float(tmp.data(), dst, dim);
}

bool code_predictor_step(const TalkerWeights *        tw,
                         const CodePredictorWeights * cw,
                         ggml_backend_sched_t         sched,
                         const float *                talker_hidden_last,
                         int                          c0,
                         float                        temperature,
                         int                          top_k,
                         float                        top_p,
                         int64_t                      seed,
                         int64_t                      subseq_base,
                         const char *                 dump_dir,
                         CodePredictorOutput *        out) {
    // sub_input lives at the talker hidden dimension because both the
    // talker last hidden and the codec_embedding rows feeding the sub
    // network are talker-sized in the upstream checkpoint. The recompute
    // graph projects them down to predictor hidden when mtp_proj is
    // present, or feeds them straight when the projection is identity.
    const int talker_hidden = tw->hidden_size;
    const int n_acoustic    = cw->num_acoustic_codebooks;

    out->codes.assign((size_t) (n_acoustic + 1), 0);
    out->codes[0] = c0;

    std::vector<float> sub_input((size_t) (n_acoustic + 1) * (size_t) talker_hidden, 0.0f);
    int                T = 0;

    std::memcpy(sub_input.data() + (size_t) T * (size_t) talker_hidden, talker_hidden_last,
                (size_t) talker_hidden * sizeof(float));
    T++;

    embed_row_from_backend(tw->codec_embedding, c0, talker_hidden,
                           sub_input.data() + (size_t) T * (size_t) talker_hidden);
    T++;

    // Acoustic codebooks have no repetition penalty in upstream defaults
    // so we pass a null history.
    for (int g = 0; g < n_acoustic; g++) {
        std::vector<float> logits;
        if (!code_predictor_recompute(cw, sched, sub_input.data(), T, talker_hidden, g, &logits)) {
            return false;
        }
        float u_g = 0.0f;
        int   cg = sample_top_k_p(logits.data(), (int) logits.size(), temperature, top_k, top_p, 1.0f, nullptr, 0, seed,
                                  subseq_base + 1 + g, &u_g);
        // Trace the first 32 samples unconditionally : that window
        // matches the Python harness seq < 32 trace, so [Sample-CP] and
        // [Sample-PY] align by subseq id when the cossim test runs.
        if (subseq_base + 1 + g < 32) {
            fprintf(stderr, "[Sample-CP] g=%d c=%d u=%.10f subseq=%lld\n", g, cg, (double) u_g,
                    (long long) (subseq_base + 1 + g));
        }
        if (cg < 0) {
            fprintf(stderr, "[CodePredictor] FATAL: sample returned no candidate\n");
            return false;
        }
        out->codes[(size_t) (g + 1)] = cg;

        if (g + 1 < n_acoustic) {
            embed_row_from_backend(cw->codec_embedding[(size_t) g], cg, talker_hidden,
                                   sub_input.data() + (size_t) T * (size_t) talker_hidden);
            T++;
        }
    }

    if (dump_dir) {
        DebugDumper d;
        debug_init(&d, dump_dir);
        std::vector<int32_t> codes32(out->codes.begin(), out->codes.end());
        int                  n = (int) codes32.size();
        debug_dump_i32_as_f32(&d, "codes-step0", codes32.data(), &n, 1);
    }

    return true;
}
