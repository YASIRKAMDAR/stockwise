package app.stockwise.staff.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

/** WhatsApp-style press-and-hold: hold to record, release to send, slide left to cancel; a quick tap shows a hint. */
fun Modifier.holdToTalk(onStart: () -> Unit, onSend: () -> Unit, onCancel: () -> Unit, onTap: () -> Unit, onArm: (Boolean) -> Unit = {}): Modifier = composed {
    val start by rememberUpdatedState(onStart); val send by rememberUpdatedState(onSend); val cancel by rememberUpdatedState(onCancel)
    val tap by rememberUpdatedState(onTap); val arm by rememberUpdatedState(onArm)
    val haptic = LocalHapticFeedback.current
    val threshold = with(LocalDensity.current) { 70.dp.toPx() }
    pointerInput(Unit) {
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            down.consume()
            val t0 = System.currentTimeMillis(); val x0 = down.position.x
            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
            start()
            var armed = false
            while (true) {
                val ev = awaitPointerEvent()
                val c = ev.changes.firstOrNull { it.id == down.id } ?: break
                if (!c.pressed) { c.consume(); break }
                val a = c.position.x - x0 < -threshold
                if (a != armed) { armed = a; arm(a); if (a) haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove) }
                c.consume()
            }
            arm(false)
            when { System.currentTimeMillis() - t0 < 350 -> { cancel(); tap() }; armed -> cancel(); else -> send() }
        }
    }
}

fun fmtSecs(ms: Long): String { val s = (ms / 1000).coerceAtLeast(0); return "%d:%02d".format(s / 60, s % 60) }

/** The bar at the bottom: type and the button becomes Send; leave it empty and it's a hold-to-talk mic. */
@Composable
fun Composer(
    placeholder: String, slideText: String, releaseCancelText: String,
    live: Boolean, startedAt: Long, interim: String, busy: Boolean, micAvailable: Boolean,
    onText: (String) -> Unit, onStart: () -> Unit, onSend: () -> Unit, onCancel: () -> Unit, onTap: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var text by remember { mutableStateOf("") }
    var armed by remember { mutableStateOf(false) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(live) { while (live) { now = System.currentTimeMillis(); delay(250) } }
    val submit = { val v = text.trim(); if (v.isNotEmpty() && !busy) { text = ""; onText(v) } }
    Row(modifier.fillMaxWidth().background(C.Linen).padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f).height(56.dp).clip(RoundedCornerShape(28.dp)).background(C.Paper)
            .border(1.5.dp, if (live) (if (armed) C.Ink3 else C.Brick) else C.Line, RoundedCornerShape(28.dp)).padding(horizontal = 20.dp),
            contentAlignment = Alignment.CenterStart) {
            if (live) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(10.dp).clip(CircleShape).background(C.Brick))
                    Spacer(Modifier.width(8.dp))
                    Text(fmtSecs(now - startedAt), fontWeight = FontWeight.Bold, color = C.Ink)
                    Spacer(Modifier.width(10.dp))
                    Text(if (armed) releaseCancelText else interim.ifBlank { slideText }, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        color = if (armed) C.Brick else C.Ink2, fontWeight = if (armed) FontWeight.Bold else FontWeight.Normal)
                }
            } else {
                BasicTextField(value = text, onValueChange = { text = it }, singleLine = true, enabled = !busy,
                    textStyle = TextStyle(fontSize = 17.sp, color = C.Ink), cursorBrush = SolidColor(C.Indigo),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send), keyboardActions = KeyboardActions(onSend = { submit() }),
                    modifier = Modifier.fillMaxWidth().semantics { contentDescription = placeholder },
                    decorationBox = { inner -> if (text.isEmpty()) Text(placeholder, color = C.Ink3, maxLines = 1); inner() })
            }
        }
        Spacer(Modifier.width(8.dp))
        val typing = text.isNotBlank() && !live
        Box(Modifier.size(60.dp).scale(if (live) 1.15f else 1f).clip(CircleShape)
            .background(when { busy -> C.Line; typing -> C.Mint; live && armed -> C.Ink3; live -> C.Brick; else -> C.Marigold })
            .then(if (typing) Modifier.clickable { submit() } else if (busy) Modifier else Modifier.holdToTalk(
                onStart = { if (micAvailable) onStart() }, onSend = { if (micAvailable) onSend() else onTap() },
                onCancel = { if (micAvailable) onCancel() }, onTap = onTap, onArm = { armed = it }))
            .semantics { contentDescription = if (typing) "Send" else "Hold to talk" },
            contentAlignment = Alignment.Center) {
            when {
                busy -> CircularProgressIndicator(Modifier.size(26.dp), color = C.Ink, strokeWidth = 3.dp)
                typing -> Icon(Icons.AutoMirrored.Filled.Send, null, tint = Color.White, modifier = Modifier.size(28.dp))
                else -> Icon(Icons.Filled.Mic, null, tint = if (live) Color.White else C.Ink, modifier = Modifier.size(30.dp))
            }
        }
    }
}

@Composable
fun Banner(text: String, warn: Boolean = true, modifier: Modifier = Modifier) {
    Text(text, modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(if (warn) C.MarigoldWash else C.MintWash).padding(14.dp),
        color = if (warn) C.Amber else Color(0xFF0F5C3C), fontWeight = FontWeight.SemiBold)
}

@Composable
fun BigButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, color: Color = C.Indigo, outline: Boolean = false) {
    if (outline) OutlinedButton(onClick, modifier.fillMaxWidth().height(58.dp), enabled = enabled, shape = RoundedCornerShape(16.dp),
        border = androidx.compose.foundation.BorderStroke(2.dp, C.Ink), colors = ButtonDefaults.outlinedButtonColors(contentColor = C.Ink)) { Text(text, style = MaterialTheme.typography.labelLarge) }
    else Button(onClick, modifier.fillMaxWidth().height(58.dp), enabled = enabled, shape = RoundedCornerShape(16.dp),
        colors = ButtonDefaults.buttonColors(containerColor = color, contentColor = Color.White, disabledContainerColor = C.Line)) { Text(text, style = MaterialTheme.typography.labelLarge) }
}

@Composable
fun Panel(modifier: Modifier = Modifier, border: Color = C.Line, bg: Color = C.Paper, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(bg).border(1.dp, border, RoundedCornerShape(16.dp)).padding(14.dp), content = content)
}
