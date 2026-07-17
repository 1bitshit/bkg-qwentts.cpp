#pragma once

#include "audience_profile.h"

#include <array>
#include <random>
#include <string>

namespace talkshow {

class audience_random {
public:
    explicit audience_random(uint32_t seed = 1997u) : rng_(seed) {}

    std::array<audience_profile, 3> create_cast(const std::string & topic) {
        (void) topic;
        return {
            make("audience_curious", "Neugierige Stimme", "Das musst du jetzt genauer erklären!"),
            make("audience_moral", "Empörte Stimme", "Das kann ich überhaupt nicht nachvollziehen!"),
            make("audience_provocateur", "Freche Stimme", "Jetzt sag endlich die Wahrheit!"),
        };
    }

private:
    audience_profile make(const std::string & id, const std::string & personality, const std::string & tagline) {
        static const char * names[] = { "Petra", "Murat", "Svenja", "Ralf", "Denise", "Tobias" };
        std::uniform_int_distribution<int> pick(0, 5);
        audience_profile out;
        out.id = id;
        out.name = names[pick(rng_)];
        out.personality = personality;
        out.tagline = tagline;
        out.voice_id = id + "_voice";
        out.voice_description = personality + ", spontan, deutlich, glaubwürdig aus einem Studiopublikum";
        return out;
    }

    std::mt19937 rng_;
};

} // namespace talkshow
