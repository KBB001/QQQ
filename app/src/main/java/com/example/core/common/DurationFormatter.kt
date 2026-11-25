package com.example.core.common

import java.util.Locale

object DurationFormatter {
    fun formatSeconds(totalSeconds: Long): String {
        if (totalSeconds <= 0L) return "0:00"
        val hours = totalSeconds / 3600
        val minutes = (totalSeconds % 3600) / 60
        val seconds = totalSeconds % 60
        return if (hours > 0) {
            String.format(Locale.US, "%d:%02d:%02d", hours, minutes, seconds)
        } else {
            String.format(Locale.US, "%d:%02d", minutes, seconds)
        }
    }

    fun formatMillis(totalMillis: Long): String {
        return formatSeconds((totalMillis.coerceAtLeast(0L)) / 1000L)
    }

    fun formatTrackCount(count: Int): String {
        val safe = count.coerceAtLeast(0)
        val mod100 = safe % 100
        val mod10 = safe % 10
        val word = when {
            mod100 in 11..14 -> "треков"
            mod10 == 1 -> "трек"
            mod10 in 2..4 -> "трека"
            else -> "треков"
        }
        return "$safe $word"
    }

    fun formatBytes(bytes: Long): String {
        val safe = bytes.coerceAtLeast(0L)
        if (safe == 0L) return "0 МБ"
        val mb = safe / (1024f * 1024f)
        return if (mb >= 1024f) {
            String.format(Locale.US, "%.2f ГБ", mb / 1024f)
        } else if (mb >= 10f) {
            String.format(Locale.US, "%.0f МБ", mb)
        } else {
            String.format(Locale.US, "%.1f МБ", mb)
        }
    }
}
