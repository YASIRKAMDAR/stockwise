package app.stockwise.staff.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

object C {
    val Ink = Color(0xFF1D2340); val Ink2 = Color(0xFF4A5072); val Ink3 = Color(0xFF6B7194)
    val Linen = Color(0xFFF7F8FB); val Line = Color(0xFFE3E6EF); val Paper = Color.White
    val Indigo = Color(0xFF2F3FA8); val IndigoWash = Color(0xFFEEF0FB)
    val Marigold = Color(0xFFF2A93B); val MarigoldWash = Color(0xFFFFF1D6); val Amber = Color(0xFF7A4800)
    val Mint = Color(0xFF1E9E6A); val MintWash = Color(0xFFE3F5EC); val Brick = Color(0xFFC2413A)
}

@Composable
fun StaffTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(primary = C.Indigo, onPrimary = Color.White, secondary = C.Marigold, background = C.Linen, surface = C.Paper, onSurface = C.Ink, onBackground = C.Ink, error = C.Brick),
        typography = Typography(
            headlineSmall = TextStyle(fontSize = 24.sp, fontWeight = FontWeight.Bold, color = C.Ink),
            titleLarge = TextStyle(fontSize = 20.sp, fontWeight = FontWeight.Bold, color = C.Ink),
            titleMedium = TextStyle(fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = C.Ink),
            bodyLarge = TextStyle(fontSize = 17.sp, color = C.Ink),
            bodyMedium = TextStyle(fontSize = 15.sp, color = C.Ink2),
            labelLarge = TextStyle(fontSize = 17.sp, fontWeight = FontWeight.Bold),
        ),
        content = content,
    )
}
