package app.stockwise.staff

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
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
        override fun start(lang: String, onInterim: (String) -> Unit, onDone: (String?, Int?) -> Unit) { speaker.stop(); listener.start(lang, onInterim, onDone) }
        override fun release() = listener.release()
        override fun cancel() = listener.cancel()
        override fun say(text: String, lang: String) = speaker.say(text, lang)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
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

    override fun onDestroy() { listener.destroy(); speaker.shutdown(); super.onDestroy() }
}
