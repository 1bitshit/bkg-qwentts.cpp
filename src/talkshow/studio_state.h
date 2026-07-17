#pragma once

#include "guest_profile.h"

#include <string>

namespace talkshow {

inline const char * stage_name(guest_stage stage) {
    switch (stage) {
        case guest_stage::normal: return "normal";
        case guest_stage::warned: return "warned";
        case guest_stage::removed: return "removed";
        case guest_stage::outside: return "outside";
        case guest_stage::return_attempt: return "return_attempt";
        case guest_stage::security_stop: return "security_stop";
    }
    return "normal";
}

inline guest_stage advance_stage(guest_stage stage, float pressure) {
    if (pressure < 0.25f) return stage;
    switch (stage) {
        case guest_stage::normal: return guest_stage::warned;
        case guest_stage::warned: return guest_stage::removed;
        case guest_stage::removed: return guest_stage::outside;
        case guest_stage::outside: return guest_stage::return_attempt;
        case guest_stage::return_attempt: return guest_stage::security_stop;
        case guest_stage::security_stop: return guest_stage::security_stop;
    }
    return guest_stage::normal;
}

} // namespace talkshow
