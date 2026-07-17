#pragma once

#include <string>

namespace talkshow {

enum class audience_rank {
    audience,
    regular,
    guest_candidate,
    former_guest,
};

struct audience_profile {
    std::string id;
    std::string name;
    std::string personality;
    std::string tagline;
    std::string voice_id;
    std::string voice_description;
    int         appearances = 0;
    int         strong_questions = 0;
    audience_rank rank = audience_rank::audience;

    void record_appearance(bool strong_question) {
        ++appearances;
        if (strong_question) ++strong_questions;
        if (appearances >= 8 || strong_questions >= 5) rank = audience_rank::guest_candidate;
        else if (appearances >= 3) rank = audience_rank::regular;
    }
};

} // namespace talkshow
