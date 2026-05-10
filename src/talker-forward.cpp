// talker-forward.cpp : eager prefill graph for the Talker LM.
//
// Mirrors Qwen3TTSTalkerDecoderLayer for TTS-only operation :
//   pre-norm, GQA attention with per-head QK-norm, mrope collapsed to
//   1D NEOX (since the three multimodal axes share position ids in TTS
//   mode), SwiGLU MLP, two residuals, repeated 28 times, then final
//   RMSNorm and codec_head. Eager softmax in F32, no flash-attention,
//   no KV cache.
//
// Tensor shapes follow ggml row-major convention : ne[0] is the fastest
// axis. Our input embedding lives as [hidden, T] inside the graph and
// the loader feeds it from a [T, hidden] f32 row-major host buffer
// (which becomes [hidden, T] in ggml after a 2d view because rows on
// the host are contiguous along the hidden axis).

#include "talker-forward.h"

#include "ggml-alloc.h"
#include "ggml-backend.h"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

// Bisect layers dumped when a dump_dir is set. Match the Python hook list
// in tests/debug-tts-cossim.py : 0, 7, 14, 21, 27.
static const int BISECT_LAYERS[] = { 0, 7, 14, 21, 27 };
static const int N_BISECT_LAYERS = (int) (sizeof(BISECT_LAYERS) / sizeof(BISECT_LAYERS[0]));

static bool is_bisect_layer(int l) {
    for (int i = 0; i < N_BISECT_LAYERS; i++) {
        if (BISECT_LAYERS[i] == l) {
            return true;
        }
    }
    return false;
}

// Build the per-layer block. Returns the layer output [hidden, T].
static struct ggml_tensor * talker_layer_forward(struct ggml_context * ctx,
                                                 const TalkerWeights * tw,
                                                 const TalkerLayer &   layer,
                                                 struct ggml_tensor *  x,
                                                 struct ggml_tensor *  positions,
                                                 struct ggml_tensor *  mask,
                                                 int                   T) {
    const int   n_q_heads = tw->num_attention_heads;
    const int   n_kv      = tw->num_key_value_heads;
    const int   hd        = tw->head_dim;
    const float eps       = tw->rms_norm_eps;

    // Pre-norm
    struct ggml_tensor * h = ggml_rms_norm(ctx, x, eps);
    h                      = ggml_mul(ctx, h, layer.input_norm_w);

    // Q/K/V projections
    struct ggml_tensor * q = ggml_mul_mat(ctx, layer.attn.q_proj_w, h);  // [n_q_heads*hd, T]
    struct ggml_tensor * k = ggml_mul_mat(ctx, layer.attn.k_proj_w, h);  // [n_kv*hd, T]
    struct ggml_tensor * v = ggml_mul_mat(ctx, layer.attn.v_proj_w, h);  // [n_kv*hd, T]

    q = ggml_reshape_3d(ctx, q, hd, n_q_heads, T);                       // [hd, n_q_heads, T]
    k = ggml_reshape_3d(ctx, k, hd, n_kv, T);
    v = ggml_reshape_3d(ctx, v, hd, n_kv, T);

    // Per-head QK-norm : RMS over hd, then multiply by [hd] gain. The
    // norm operates on ne[0] = hd, identical layout for q (16 heads) and
    // k (8 heads), so the same code path covers both.
    q = ggml_rms_norm(ctx, q, eps);
    q = ggml_mul(ctx, q, layer.attn.q_norm_w);
    k = ggml_rms_norm(ctx, k, eps);
    k = ggml_mul(ctx, k, layer.attn.k_norm_w);

    // RoPE NEOX (half-split). In TTS-only mode the three mrope axes share
    // position ids, so the multimodal interleaved cos/sin collapses to
    // plain 1D rotate_half with the same freq base.
    q = ggml_rope_ext(ctx, q, positions, NULL, hd, GGML_ROPE_TYPE_NEOX, 0, tw->rope_theta, 1.0f, 0.0f, 1.0f, 0.0f,
                      0.0f);
    k = ggml_rope_ext(ctx, k, positions, NULL, hd, GGML_ROPE_TYPE_NEOX, 0, tw->rope_theta, 1.0f, 0.0f, 1.0f, 0.0f,
                      0.0f);

    // Attention layout : [hd, T, n_heads]. ggml_mul_mat broadcasts on
    // dims 2/3 when source has fewer heads than destination, which is
    // exactly the GQA case with n_q_heads = n_kv * n_rep, no explicit
    // repeat_kv needed.
    struct ggml_tensor * q_p = ggml_cont(ctx, ggml_permute(ctx, q, 0, 2, 1, 3));
    struct ggml_tensor * k_p = ggml_cont(ctx, ggml_permute(ctx, k, 0, 2, 1, 3));
    struct ggml_tensor * v_p = ggml_cont(ctx, ggml_permute(ctx, v, 1, 2, 0, 3));  // [T, n_kv, hd]

    struct ggml_tensor * scores = ggml_mul_mat(ctx, k_p, q_p);
    ggml_mul_mat_set_prec(scores, GGML_PREC_F32);

    float scale = 1.0f / sqrtf((float) hd);
    scores      = ggml_soft_max_ext(ctx, scores, mask, scale, 0.0f);

    struct ggml_tensor * attn = ggml_mul_mat(ctx, v_p, scores);
    attn                      = ggml_cont(ctx, ggml_permute(ctx, attn, 0, 2, 1, 3));
    attn                      = ggml_reshape_2d(ctx, attn, n_q_heads * hd, T);

    struct ggml_tensor * o = ggml_mul_mat(ctx, layer.attn.o_proj_w, attn);

    x = ggml_add(ctx, x, o);

    // MLP block : pre-norm + SwiGLU + residual
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

bool talker_forward_prefill(const TalkerWeights * tw,
                            ggml_backend_sched_t  sched,
                            const float *         input_embed,
                            int                   T,
                            const char *          dump_dir,
                            TalkerForwardOutput * out) {
    const int hidden   = tw->hidden_size;
    const int n_layers = tw->num_hidden_layers;
    const int vocab    = tw->vocab_size;

    // Dedicated context for graph + IO tensors. Counts approximate :
    //   per layer : ~30 ops -> ~30 graph nodes
    //   IO        : 4 tensors (input embed, positions, mask, output norm)
    //   final     : norm + codec_head + ~3 dump branches
    const int    max_nodes         = 32 * n_layers + 256;
    const size_t graph_arena_bytes = ggml_tensor_overhead() * max_nodes + ggml_graph_overhead_custom(max_nodes, false);

    struct ggml_init_params gparams = {
        graph_arena_bytes,
        NULL,
        true,
    };
    struct ggml_context * gctx = ggml_init(gparams);
    if (!gctx) {
        fprintf(stderr, "[TalkerForward] FATAL: ggml_init failed\n");
        return false;
    }

    // IO tensors : input embedding, positions, causal mask
    struct ggml_tensor * x_in    = ggml_new_tensor_2d(gctx, GGML_TYPE_F32, hidden, T);
    struct ggml_tensor * pos_in  = ggml_new_tensor_1d(gctx, GGML_TYPE_I32, T);
    struct ggml_tensor * mask_in = ggml_new_tensor_2d(gctx, GGML_TYPE_F32, T, T);
    ggml_set_name(x_in, "input_embed");
    ggml_set_name(pos_in, "positions");
    ggml_set_name(mask_in, "causal_mask");

    // Build the layer stack. We collect bisect taps into a vector so the
    // graph keeps them as roots and the scheduler does not optimize them
    // away.
    struct ggml_cgraph * gf = ggml_new_graph_custom(gctx, max_nodes, false);

    struct ggml_tensor *              h = x_in;
    std::vector<struct ggml_tensor *> taps(N_BISECT_LAYERS, NULL);
    for (int l = 0; l < n_layers; l++) {
        h = talker_layer_forward(gctx, tw, tw->layers[(size_t) l], h, pos_in, mask_in, T);
        if (dump_dir && is_bisect_layer(l)) {
            for (int i = 0; i < N_BISECT_LAYERS; i++) {
                if (BISECT_LAYERS[i] == l) {
                    char tap_name[64];
                    snprintf(tap_name, sizeof(tap_name), "tap_l%d", l);
                    ggml_set_name(h, tap_name);
                    ggml_set_output(h);
                    taps[(size_t) i] = h;
                    break;
                }
            }
        }
    }

    struct ggml_tensor * h_final = ggml_rms_norm(gctx, h, tw->rms_norm_eps);
    h_final                      = ggml_mul(gctx, h_final, tw->norm_w);
    ggml_set_name(h_final, "hidden_final");
    ggml_set_output(h_final);

    // codec_head : [hidden, vocab]. ggml_mul_mat returns [vocab, T].
    struct ggml_tensor * logits = ggml_mul_mat(gctx, tw->codec_head_w, h_final);
    ggml_set_name(logits, "logits");

    // Wire dump roots and final outputs into the graph.
    if (dump_dir) {
        for (int i = 0; i < N_BISECT_LAYERS; i++) {
            if (taps[(size_t) i]) {
                ggml_build_forward_expand(gf, taps[(size_t) i]);
            }
        }
        ggml_build_forward_expand(gf, h_final);
    }
    ggml_build_forward_expand(gf, logits);

    // Allocate intermediate buffers via the scheduler. The scheduler
    // partitions ops between the GPU and the CPU fallback before
    // alloc_graph wires up the buffers, so K-quant get_rows that the
    // GPU backend cannot run land on the CPU instead of asserting.
    if (!ggml_backend_sched_alloc_graph(sched, gf)) {
        fprintf(stderr, "[TalkerForward] FATAL: graph allocation failed\n");
        ggml_backend_sched_reset(sched);
        ggml_free(gctx);
        return false;
    }

    // Upload input embedding (host [T, hidden] -> ggml [hidden, T]).
    // The host buffer is row-major with hidden as the inner axis, which
    // matches ggml's ne[0]-fastest layout exactly.
    ggml_backend_tensor_set(x_in, input_embed, 0, (size_t) T * (size_t) hidden * sizeof(float));

    // Positions 0..T-1
    {
        std::vector<int32_t> pos((size_t) T);
        for (int i = 0; i < T; i++) {
            pos[(size_t) i] = i;
        }
        ggml_backend_tensor_set(pos_in, pos.data(), 0, (size_t) T * sizeof(int32_t));
    }

    // Causal mask : 0 on/below diagonal, -inf above. Stored row-major
    // [T_q, T_k] with T_k as the fast axis (ne[0]).
    {
        std::vector<float> mask((size_t) T * (size_t) T, -INFINITY);
        for (int q = 0; q < T; q++) {
            for (int k = 0; k <= q; k++) {
                mask[(size_t) q * (size_t) T + (size_t) k] = 0.0f;
            }
        }
        ggml_backend_tensor_set(mask_in, mask.data(), 0, mask.size() * sizeof(float));
    }

    // Compute through the scheduler so cross-backend op placement stays
    // honoured for every node in the graph.
    if (ggml_backend_sched_graph_compute(sched, gf) != GGML_STATUS_SUCCESS) {
        fprintf(stderr, "[TalkerForward] FATAL: graph compute failed\n");
        ggml_backend_sched_reset(sched);
        ggml_free(gctx);
        return false;
    }

    // Bisect dumps : pull each tap [hidden, T] back to host as [T, hidden]
    // f32 row-major (which is exactly the ggml byte layout).
    if (dump_dir) {
        DebugDumper d;
        debug_init(&d, dump_dir);
        std::vector<float> buf((size_t) T * (size_t) hidden);
        for (int i = 0; i < N_BISECT_LAYERS; i++) {
            if (!taps[(size_t) i]) {
                continue;
            }
            ggml_backend_tensor_get(taps[(size_t) i], buf.data(), 0, buf.size() * sizeof(float));
            char name[64];
            snprintf(name, sizeof(name), "talker-hidden-prefill-l%d", BISECT_LAYERS[i]);
            debug_dump_2d(&d, name, buf.data(), T, hidden);
        }
        ggml_backend_tensor_get(h_final, buf.data(), 0, buf.size() * sizeof(float));
        debug_dump_2d(&d, "talker-hidden-prefill-final", buf.data(), T, hidden);
    }

    // Pull the last position : final hidden + logits
    out->hidden = hidden;
    out->vocab  = vocab;
    out->hidden_last.assign((size_t) hidden, 0.0f);
    out->logits_last.assign((size_t) vocab, 0.0f);
    {
        // Logits ggml shape : [vocab, T]. We want the row at column T-1.
        // Layout : data[t * vocab + v], so the offset for t = T-1 is
        // (T-1) * vocab * 4 bytes.
        size_t row_bytes = (size_t) vocab * sizeof(float);
        ggml_backend_tensor_get(logits, out->logits_last.data(), (size_t) (T - 1) * row_bytes, row_bytes);

        size_t hrow_bytes = (size_t) hidden * sizeof(float);
        ggml_backend_tensor_get(h_final, out->hidden_last.data(), (size_t) (T - 1) * hrow_bytes, hrow_bytes);
    }

    if (dump_dir) {
        DebugDumper d;
        debug_init(&d, dump_dir);
        debug_dump_1d(&d, "talker-logits-prefill", out->logits_last.data(), vocab);
    }

    ggml_backend_sched_reset(sched);
    ggml_free(gctx);
    return true;
}
