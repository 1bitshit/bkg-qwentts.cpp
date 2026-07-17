#pragma once

#include <string>
#include <vector>

namespace talkshow {

enum class guest_stage {
    normal,
    warned,
    removed,
    outside,
    return_attempt,
    security_stop,
};

struct guest_profile {
    std::string id;
    std::string name;
    int         age = 0;
    std::string origin;
    std::string occupation;
    std::string biography;
    std::string position;
    std::string personality;
    std::string tagline;
    std::string voice_id;
    std::string voice_description;
    std::string emotion_profile;
    int         appearances = 0;
    guest_stage stage = guest_stage::normal;
};

struct guest_roster {
    std::vector<guest_profile> guests;
    int segment_minutes = 6;

    int total_minutes() const {
        return (int) guests.size() * segment_minutes;
    }

    std::vector<guest_profile *> active_for_segment(int segment) {
        std::vector<guest_profile *> out;
        const int count = segment < 0 ? 0 : std::min((int) guests.size(), segment + 1);
        for (int i = 0; i < count; ++i) out.push_back(&guests[(size_t) i]);
        return out;
    }
};

} // namespace talkshow
