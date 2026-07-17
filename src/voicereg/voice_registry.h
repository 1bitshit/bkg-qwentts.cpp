#pragma once

#include "voice_store.h"

#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

namespace voicereg {

struct voice_summary {
    std::string id;
    std::string display_name;
    std::string description;
    std::string domain;
};

class voice_registry {
public:
    explicit voice_registry(std::filesystem::path root)
        : store_(std::move(root)) {}

    bool reload(std::string & warning) {
        auto loaded = store_.load_all(warning);
        std::lock_guard<std::mutex> lock(mutex_);
        voices_.clear();
        for (auto & voice : loaded) {
            voices_.emplace(voice->id, std::move(voice));
        }
        return warning.empty();
    }

    bool put(voice_profile && voice, std::string & error) {
        if (!store_.save(voice, error)) {
            return false;
        }
        auto shared = std::make_shared<voice_profile>(std::move(voice));
        std::lock_guard<std::mutex> lock(mutex_);
        voices_[shared->id] = std::move(shared);
        return true;
    }

    std::shared_ptr<const voice_profile> find(const std::string & id) const {
        std::lock_guard<std::mutex> lock(mutex_);
        const auto it = voices_.find(id);
        return it == voices_.end() ? nullptr : it->second;
    }

    bool remove(const std::string & id, std::string & error) {
        if (!store_.remove(id, error)) {
            return false;
        }
        std::lock_guard<std::mutex> lock(mutex_);
        return voices_.erase(id) > 0;
    }

    std::vector<std::string> ids() const {
        std::vector<std::string> result;
        std::lock_guard<std::mutex> lock(mutex_);
        result.reserve(voices_.size());
        for (const auto & item : voices_) {
            result.push_back(item.first);
        }
        std::sort(result.begin(), result.end());
        return result;
    }

    std::vector<voice_summary> summaries() const {
        std::vector<voice_summary> result;
        std::lock_guard<std::mutex> lock(mutex_);
        result.reserve(voices_.size());
        for (const auto & item : voices_) {
            result.push_back({ item.second->id, item.second->display_name,
                               item.second->description, item.second->domain });
        }
        std::sort(result.begin(), result.end(), [](const auto & a, const auto & b) {
            return a.display_name < b.display_name;
        });
        return result;
    }

    size_t size() const {
        std::lock_guard<std::mutex> lock(mutex_);
        return voices_.size();
    }

    const voice_store & store() const {
        return store_;
    }

private:
    voice_store store_;
    mutable std::mutex mutex_;
    std::unordered_map<std::string, std::shared_ptr<voice_profile>> voices_;
};

} // namespace voicereg
