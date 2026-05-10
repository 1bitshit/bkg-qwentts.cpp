#pragma once
// qt-error.h : internal helpers backing the (future) public qt_last_error
// entry and the qt_log callback routing.
//
// Storage is thread_local so concurrent synthesize calls on different
// threads never race on each other's messages. The setter is variadic
// with printf semantics ; messages longer than the internal buffer are
// truncated, never split. Passing NULL as fmt clears the slot.
//
// qt_throw is the load-path counterpart : functions deep inside the GGUF
// reader and the codec load chain cannot return false up dozens of call
// sites without a massive cascade. They throw a std::runtime_error
// instead, which the binary entry point (main, or a future ABI boundary)
// catches and converts to qt_set_error plus a non-zero exit. Exceptions
// never cross any future C ABI.
//
// qt_log routes a formatted message to the user-installed qt_log_cb, or
// to stderr when no callback is installed. Used by every translation
// unit in the lib that wants its diagnostics to be redirectable from a
// wrapper (Python logging, Rust tracing, ...).

#include <cstdarg>

enum qt_log_level {
    QT_LOG_DEBUG = 0,
    QT_LOG_INFO  = 1,
    QT_LOG_WARN  = 2,
    QT_LOG_ERROR = 3,
};

typedef void (*qt_log_cb)(enum qt_log_level level, const char * msg, void * user_data);

void qt_set_error(const char * fmt, ...)
#if defined(__GNUC__) || defined(__clang__)
    __attribute__((format(printf, 1, 2)))
#endif
    ;

void qt_set_error_v(const char * fmt, va_list ap);

// Throws std::runtime_error formatted with printf semantics. Tagged
// noreturn so the compiler can prune unreachable branches at the call
// site. Designed for the GGUF / codec load path where any failure means
// the model is unusable and unwinding to the boundary is the only sane
// recovery.
[[noreturn]] void qt_throw(const char * fmt, ...)
#if defined(__GNUC__) || defined(__clang__)
    __attribute__((format(printf, 1, 2)))
#endif
    ;

// Routes a formatted message at the requested level to the installed
// callback, or to stderr when none is set. The message is the full line
// without trailing newline ; routing layers add their own framing.
void qt_log(enum qt_log_level level, const char * fmt, ...)
#if defined(__GNUC__) || defined(__clang__)
    __attribute__((format(printf, 2, 3)))
#endif
    ;

// Install a process-wide log callback. Pass NULL to revert to stderr.
// user_data is opaque, forwarded as-is to every callback invocation.
void qt_log_set(qt_log_cb cb, void * user_data);

// Returns the most recent error message recorded on the calling thread.
// Returns "" if no error has been set on this thread. The pointer stays
// valid until the next qt_set_error call on the same thread.
const char * qt_last_error(void);
