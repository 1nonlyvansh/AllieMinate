package com.alliminate.android

import android.content.Context
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter

private const val CRASH_FILE = "last_crash.txt"

/** Without this, "the app just closes" is unfalsifiable — no logcat access from here, no way to know
 * which line actually failed. Installs a global handler that writes the real stack trace to a file
 * MainActivity reads and shows (with a Copy button) the next time the app opens, then hands off to the
 * OS's normal crash handling so the process still dies cleanly. */
object CrashHandler {
    fun install(context: Context) {
        val appContext = context.applicationContext
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            runCatching {
                val writer = StringWriter()
                throwable.printStackTrace(PrintWriter(writer))
                File(appContext.filesDir, CRASH_FILE).writeText(writer.toString())
            }
            previous?.uncaughtException(thread, throwable)
        }
    }

    fun readAndClear(context: Context): String? {
        val file = File(context.filesDir, CRASH_FILE)
        if (!file.exists()) return null
        val text = runCatching { file.readText() }.getOrNull()
        file.delete()
        return text
    }
}
