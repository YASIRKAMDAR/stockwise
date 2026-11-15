package app.stockwise.staff

import android.Manifest
import android.content.pm.PackageManager
import android.media.MediaRecorder
import android.os.Build
import android.os.Bundle
import java.io.File
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.emoji2.bundled.BundledEmojiCompatConfig
import androidx.emoji2.text.EmojiCompat
import app.stockwise.staff.ui.Mic
import app.stockwise.staff.ui.StaffApp

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
        override fun start(lang: String, record: Boolean, onInterim: (String) -> Unit, onDone: (String?, Int?) -> Unit) {
            speaker.stop()
            if (record) startRecording(onDone) else listener.start(lang, onInterim, onDone)
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

    private fun startRecording(onDone: (String?, Int?) -> Unit) {
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
    }

    private fun stopRecording(keep: Boolean) {
        val r = recorder ?: return
        recorder = null
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
        setContent { StaffApp(state, mic) }
    }

    override fun onResume() {
        super.onResume()
        if (state.me != null) { state.refresh(); OutboxWorker.kick(this) }
    }

    override fun onDestroy() { if (recorder != null) stopRecording(keep = false); listener.destroy(); speaker.shutdown(); super.onDestroy() }
}
