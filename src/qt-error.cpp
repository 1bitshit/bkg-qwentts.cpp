// qt-error.cpp : implementation of the qt_log / qt_set_error / qt_throw
// helpers declared in qt-error.h. Storage is thread_local for the error
// slot, atomic for the log callback so qt_log_set is wait-free.

#include "qt-error.h"

#include <atomic>
#include <cstdio>
#include <cstring>
#include <stdexcept>
#include <string>

// Thread-local backing store for qt_last_error(). std::string sized once
// per thread, grows on demand, never freed across calls : the std runtime
// reclaims it on thread exit. An empty string means "no error recorded
// on this thread yet", which qt_last_error() exposes as "".
static thread_local std::string g_last_error;

void qt_set_error_v(const char * fmt, va_list ap) {
    if (!fmt) {
        g_last_error.clear();
        return;
    }
    // Two-pass vsnprintf : first call sizes the buffer, second writes the
    // message. va_copy keeps the original ap valid for the second pass.
    va_list ap2;
    va_copy(ap2, ap);
    int needed = std::vsnprintf(nullptr, 0, fmt, ap2);
    va_end(ap2);
    if (needed < 0) {
        g_last_error = "qt_set_error : vsnprintf failed";
        return;
    }
    g_last_error.resize(static_cast<size_t>(needed));
    std::vsnprintf(g_last_error.data(), static_cast<size_t>(needed) + 1, fmt, ap);
}

void qt_set_error(const char * fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    qt_set_error_v(fmt, ap);
    va_end(ap);
}

const char * qt_last_error(void) {
    return g_last_error.c_str();
}

// Formats a message with printf semantics and throws std::runtime_error.
// The catch site at the binary entry inspects the what() string and feeds
// it into qt_set_error so the user-visible diagnostic is identical
// whether the failure used the bool-return path or the throw path.
void qt_throw(const char * fmt, ...) {
    char buf[1024];
    if (fmt) {
        va_list ap;
        va_start(ap, fmt);
        std::vsnprintf(buf, sizeof(buf), fmt, ap);
        va_end(ap);
    } else {
        buf[0] = '\0';
    }
    throw std::runtime_error(buf);
}

// Process-wide log callback. Atomic so qt_log_set can replace it without
// locking : write happens with memory_order_release, every reader sees a
// fully published callback pointer paired with its user_data slot.
// std::atomic on a function pointer is lock-free on every platform we
// target. user_data is a plain pointer because it is only ever published
// alongside cb under the same release ordering.
static std::atomic<qt_log_cb> g_log_cb{ nullptr };
static void *                 g_log_cb_user = nullptr;

void qt_log_set(qt_log_cb cb, void * user_data) {
    g_log_cb_user = user_data;
    g_log_cb.store(cb, std::memory_order_release);
}

// Routes one log line to the installed callback or to stderr. Two-pass
// vsnprintf sizes the heap buffer when the message exceeds the stack
// scratchpad, which keeps the common case allocation-free.
void qt_log(enum qt_log_level level, const char * fmt, ...) {
    if (!fmt) {
        return;
    }
    char    stackbuf[512];
    char *  buf    = stackbuf;
    int     needed = 0;
    va_list ap;
    va_start(ap, fmt);
    {
        va_list ap2;
        va_copy(ap2, ap);
        needed = std::vsnprintf(stackbuf, sizeof(stackbuf), fmt, ap2);
        va_end(ap2);
    }
    if (needed < 0) {
        va_end(ap);
        return;
    }
    std::string heapbuf;
    if ((size_t) needed >= sizeof(stackbuf)) {
        heapbuf.resize((size_t) needed);
        std::vsnprintf(heapbuf.data(), (size_t) needed + 1, fmt, ap);
        buf = heapbuf.data();
    }
    va_end(ap);

    qt_log_cb cb = g_log_cb.load(std::memory_order_acquire);
    if (cb) {
        cb(level, buf, g_log_cb_user);
    } else {
        std::fprintf(stderr, "%s\n", buf);
    }
}
