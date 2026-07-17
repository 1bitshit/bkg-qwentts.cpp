#pragma once

#include "audience_profile.h"
#include "guest_profile.h"

namespace talkshow {

inline bool can_promote_to_guest(const audience_profile & member) {
    return member.rank == audience_rank::guest_candidate;
}

inline guest_profile promote_to_guest(const audience_profile & member) {
    guest_profile guest;
    guest.id = "guest_from_" + member.id;
    guest.name = member.name;
    guest.personality = member.personality;
    guest.tagline = member.tagline;
    guest.voice_id = member.voice_id;
    guest.voice_description = member.voice_description;
    guest.biography = "Bekanntes Mitglied des Stammpublikums, das durch wiederkehrende Fragen auffiel.";
    guest.position = "Hat eine starke persönliche Meinung zum Sendungsthema.";
    guest.appearances = member.appearances;
    return guest;
}

} // namespace talkshow
