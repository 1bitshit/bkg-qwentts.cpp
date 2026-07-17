#pragma once

#include "../qwen.h"

#include <string>
#include <utility>

namespace voicereg {

class voice_profile {
public:
    std::string id;
    std::string display_name;
    std::string description;
    std::string ref_text;
    std::string domain;
    qt_voice_ref ref{};

    voice_profile() = default;
    voice_profile(const voice_profile &) = delete;
    voice_profile & operator=(const voice_profile &) = delete;

    voice_profile(voice_profile && other) noexcept {
        move_from(std::move(other));
    }
    voice_profile & operator=(voice_profile && other) noexcept {
        if (this != &other) {
            qt_voice_ref_free(&ref);
            move_from(std::move(other));
        }
        return *this;
    }

    ~voice_profile() {
        qt_voice_ref_free(&ref);
    }

    bool valid() const {
        return !id.empty() && ref.ref_spk_emb != nullptr && ref.ref_spk_dim > 0;
    }

private:
    void move_from(voice_profile && other) noexcept {
        id = std::move(other.id);
        display_name = std::move(other.display_name);
        description = std::move(other.description);
        ref_text = std::move(other.ref_text);
        domain = std::move(other.domain);
        ref = other.ref;
        other.ref = {};
    }
};

} // namespace voicereg
