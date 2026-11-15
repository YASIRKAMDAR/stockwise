package app.stockwise.manager

import android.Manifest
import android.content.pm.PackageManager
import android.media.MediaRecorder
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Handler
import android.os.Looper
import android.os.Build
import android.os.Bundle
import java.io.File
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.emoji2.bundled.BundledEmojiCompatConfig
import androidx.emoji2.text.EmojiCompat
import app.stockwise.manager.ui.Mic
import app.stockwise.manager.ui.StaffApp

class MainActivity : ComponentActivity() {
    private lateinit var state: AppState
    private lateinit var listener: HoldListener
    private lateinit var speaker: Speaker
    private val askMic = registerForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        if (::state.isInitialized) state.notice = Notice(if (ok) state.t.holdHint else state.t.micDenied)
    }

    private val mic = object : Mic {
        override val available get() = listener.available
        override fun hasPermission() = ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        override fun requestPermission() = askMic.launch(Manifest.permission.RECORD_AUDIO)
        override fun start(lang: String, record: Boolean, onInterim: (String) -> Unit, onLevel: (Float) -> Unit, onDone: (String?, Int?) -> Unit) {
            speaker.stop()
            listener.onLevel = onLevel
            if (record) startRecording(onLevel, onDone) else listener.start(lang, onInterim, onDone)
        }
        override fun hasVoice(lang: String) = speaker.hasVoice(lang)
        override val online: Boolean get() {
            val cm = getSystemService(ConnectivityManager::class.java) ?: return true
            val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
            return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        }
        override fun release() { if (recorder != null) stopRecording(keep = true) else listener.release() }
        override fun cancel() { if (recorder != null) stopRecording(keep = false) else listener.cancel() }
        override fun takeRecording(): ByteArray? = recorded.also { recorded = null }
        override fun say(text: String, lang: String) = speaker.say(text, lang)
    }

    // Recording for Google's model (it understands Gujarati, Hindi and English mixed in one sentence).
    private var recorder: MediaRecorder? = null
    private var recFile: File? = null
    private var recDone: ((String?, Int?) -> Unit)? = null
    private var recorded: ByteArray? = null

    private val levelTicker = Handler(Looper.getMainLooper())
    private fun startRecording(onLevel: (Float) -> Unit, onDone: (String?, Int?) -> Unit) {
        recorded = null
        val f = File(cacheDir, "stockwise-voice.m4a").also { it.delete() }
        @Suppress("DEPRECATION")
        val r = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(this) else MediaRecorder()
        try {
            r.setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION)
            r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            r.setAudioChannels(1)
            r.setAudioSamplingRate(16000)
            r.setAudioEncodingBitRate(32000)
            r.setOutputFile(f.absolutePath)
            r.prepare()
            r.start()
        } catch (e: Exception) {
            runCatching { r.release() }
            onDone("", null)
            return
        }
        recorder = r; recFile = f; recDone = onDone
        // Loudness ~12 times a second while recording, so the bar moves as the staff member speaks.
        levelTicker.post(object : Runnable {
            override fun run() {
                val rec = recorder ?: return
                val amp = runCatching { rec.maxAmplitude }.getOrDefault(0)
                val db = 20 * kotlin.math.log10(amp.coerceAtLeast(1).toDouble() / 32767.0)   // -90 … 0 dB
                onLevel(((db + 45) / 40).toFloat().coerceIn(0f, 1f))
                levelTicker.postDelayed(this, 80)
            }
        })
    }

    private fun stopRecording(keep: Boolean) {
        val r = recorder ?: return
        recorder = null
        levelTicker.removeCallbacksAndMessages(null)
        val ok = runCatching { r.stop() }.isSuccess   // stop() fails when nothing was recorded
        runCatching { r.release() }
        recorded = if (keep && ok) recFile?.takeIf { it.exists() }?.readBytes() else null
        recFile?.delete(); recFile = null
        val done = recDone
        recDone = null
        done?.invoke(if (keep) "" else null, null)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Item pictures are emoji; bundle the font so older phones show them too.
        runCatching { EmojiCompat.init(BundledEmojiCompatConfig(this).setReplaceAll(true)) }
        state = AppState(this)
        listener = HoldListener(this)
        speaker = Speaker(this)
        state.boot()
        setContent { ManagerApp(state, mic) }
    }

    override fun onResume() {
        super.onResume()
        if (state.me != null) state.refresh()
    }

    override fun onDestroy() { if (recorder != null) stopRecording(keep = false); listener.destroy(); speaker.shutdown(); super.onDestroy() }
}
