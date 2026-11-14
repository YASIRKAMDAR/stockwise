package app.stockwise.staff

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import java.util.Locale

fun localeTag(lang: String) = when (lang) { "hi" -> "hi-IN"; "gu" -> "gu-IN"; else -> "en-IN" }

/**
 * Hold-to-talk with Android's own speech recognizer (works offline where the phone has the language pack).
 * Android stops listening after a pause, so while the button is held it quietly restarts and joins the pieces.
 */
class HoldListener(private val ctx: Context) {
    private var rec: SpeechRecognizer? = null
    private val main = Handler(Looper.getMainLooper())
    private var holding = false
    private var cancelled = false
    private var finished = false
    private val parts = mutableListOf<String>()
    private var partial = ""
    private var onText: (String) -> Unit = {}
    private var onDone: (String?, Int?) -> Unit = { _, _ -> }
    private var lang = "en"

    val available: Boolean get() = SpeechRecognizer.isRecognitionAvailable(ctx)

    fun start(lang: String, onInterim: (String) -> Unit, onFinished: (text: String?, error: Int?) -> Unit) {
        stopNow()
        this.lang = lang; onText = onInterim; onDone = onFinished
        holding = true; cancelled = false; finished = false; parts.clear(); partial = ""
        listen()
    }

    private fun intent() = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_LANGUAGE, localeTag(lang))
        putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
        putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 4000L)
        putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 4000L)
    }

    private fun listen() {
        rec?.destroy()
        val r = SpeechRecognizer.createSpeechRecognizer(ctx)
        rec = r
        r.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
            override fun onPartialResults(b: Bundle?) {
                partial = b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: partial
                onText((parts + partial).filter { it.isNotBlank() }.joinToString(" "))
            }
            override fun onResults(b: Bundle?) {
                val best = b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: partial
                if (best.isNotBlank()) parts += best
                partial = ""
                onText(parts.joinToString(" "))
                if (holding && !cancelled) main.post { listen() } else finish(null)
            }
            override fun onError(error: Int) {
                if (partial.isNotBlank()) { parts += partial; partial = "" }
                val benign = error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT
                if (holding && !cancelled && benign) { main.postDelayed({ if (holding) listen() }, 150); return }
                finish(if (benign || error == SpeechRecognizer.ERROR_CLIENT) null else error)
            }
        })
        r.startListening(intent())
    }

    /** Released: finish what was heard and hand it over. */
    fun release() {
        if (!holding) return
        holding = false
        rec?.stopListening()
        main.postDelayed({ finish(null) }, 2500) // some recognizers never answer after stop
    }

    fun cancel() { holding = false; cancelled = true; stopNow(); if (!finished) { finished = true; onDone(null, null) } }

    private fun finish(error: Int?) {
        if (finished) return
        finished = true
        val text = (parts + partial).filter { it.isNotBlank() }.joinToString(" ").trim()
        stopNow()
        onDone(if (cancelled) null else text, if (text.isBlank()) error else null)
    }

    private fun stopNow() { runCatching { rec?.cancel(); rec?.destroy() }; rec = null }
    fun destroy() { holding = false; stopNow() }
}

/** Reads summaries aloud in the staff member's language. */
class Speaker(ctx: Context) {
    private var ready = false
    private val tts: TextToSpeech = TextToSpeech(ctx.applicationContext) { ready = it == TextToSpeech.SUCCESS }
    fun say(text: String, lang: String) {
        if (!ready) return
        tts.language = Locale.forLanguageTag(localeTag(lang))
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "sw")
    }
    fun stop() { if (ready) tts.stop() }
    fun shutdown() = tts.shutdown()
}

private val YES = setOf("haan", "han", "ha", "haa", "yes", "yeah", "ok", "okay", "theek", "thik", "sahi", "हाँ", "हां", "हा", "ठीक", "सही", "ओके", "હા", "હાં", "બરાબર", "ઓકે", "સાચું")
private val NO = setOf("nahi", "nahin", "na", "no", "nope", "cancel", "नहीं", "नही", "ना", "ના", "નહીં", "નથી")
fun yesNo(text: String): Boolean? {
    val w = text.lowercase().split(Regex("[\\s,.!?।]+"))
    return when { w.any { it in NO } -> false; w.any { it in YES } -> true; else -> null }
}
