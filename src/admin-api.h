#pragma once

#include "../vendor/cpp-httplib/httplib.h"
#include "yyjson.h"
#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <map>
#include <string>

static bool admin_authorized(const httplib::Request & req) {
    const char * expected = std::getenv("BKG_ADMIN_API_KEY");
    return expected && *expected && req.get_header_value("X-API-Key") == expected;
}

static const std::map<std::string, std::string> & admin_actions() {
    static const std::map<std::string, std::string> actions = {
        {"build-cpu", "CPU-Build"},
        {"build-cuda", "CUDA-Build"},
        {"build-vulkan", "Vulkan-Build"},
        {"update", "Repository aktualisieren"},
        {"models", "Modelle verwalten"},
        {"format", "Quellcode formatieren"},
        {"install-lmstudio-plugin", "LM-Studio-Plugin installieren"},
    };
    return actions;
}

static void admin_scripts_list(const httplib::Request & req, httplib::Response & res) {
    if (!admin_authorized(req)) {
        res.status = 401;
        res.set_content("{\"error\":\"unauthorized\"}", "application/json");
        return;
    }
    std::string body = "{\"actions\":[";
    bool first = true;
    for (const auto & item : admin_actions()) {
        if (!first) body += ',';
        first = false;
        body += "{\"id\":\"" + item.first + "\",\"label\":\"" + item.second + "\"}";
    }
    body += "]}";
    res.set_content(body, "application/json");
}

static void admin_script_enqueue(const httplib::Request & req, httplib::Response & res) {
    if (!admin_authorized(req)) {
        res.status = 401;
        res.set_content("{\"error\":\"unauthorized\"}", "application/json");
        return;
    }
    yyjson_doc * doc = yyjson_read(req.body.c_str(), req.body.size(), 0);
    yyjson_val * root = doc ? yyjson_doc_get_root(doc) : nullptr;
    yyjson_val * value = root ? yyjson_obj_get(root, "action") : nullptr;
    std::string action = yyjson_is_str(value) ? yyjson_get_str(value) : "";
    if (doc) yyjson_doc_free(doc);
    if (admin_actions().find(action) == admin_actions().end()) {
        res.status = 400;
        res.set_content("{\"error\":\"unknown action\"}", "application/json");
        return;
    }
    namespace fs = std::filesystem;
    fs::create_directories(".runtime/admin-queue");
    auto stamp = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
    std::string id = std::to_string(stamp) + "-" + action;
    std::ofstream(".runtime/admin-queue/" + id + ".job") << action << '\n';
    res.set_content("{\"status\":\"queued\",\"job_id\":\"" + id + "\"}", "application/json");
}
