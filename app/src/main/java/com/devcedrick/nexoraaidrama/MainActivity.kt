package com.devcedrick.nexoraaidrama

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.media3.common.MediaItem
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import coil.compose.AsyncImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException

private val NexoraBlack = Color(0xFF090A0E)
private val NexoraPanel = Color(0xFF15171D)
private val NexoraGold = Color(0xFFD8B66A)
private val NexoraMuted = Color(0xFF9A9DA7)

private data class Drama(
    val id: String,
    val title: String,
    val synopsis: String,
    val genre: String,
    val coverUrl: String?
)

private data class DramaEpisode(
    val id: String,
    val number: Int,
    val title: String,
    val synopsis: String,
    val videoUrl: String,
    val thumbnailUrl: String?,
    val videoOwner: String?
)

private object DramaApi {
    private val client = OkHttpClient()

    private suspend fun get(path: String): String = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url(BuildConfig.SUPABASE_URL.trimEnd('/') + "/rest/v1/" + path)
            .header("apikey", BuildConfig.SUPABASE_PUBLISHABLE_KEY)
            .header("Accept", "application/json")
            .get()
            .build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw IOException("Catalog request failed (${response.code}).")
            response.body?.string() ?: "[]"
        }
    }

    private fun JSONObject.value(key: String): String = if (isNull(key)) "" else optString(key, "")
    private fun JSONObject.optional(key: String): String? =
        if (isNull(key)) null else optString(key).takeIf { it.isNotBlank() && it != "null" }

    suspend fun dramas(): List<Drama> {
        val rows = JSONArray(get("ai_dramas?select=id,title,synopsis,genre,cover_url&status=eq.published&order=created_at.desc"))
        return buildList {
            for (i in 0 until rows.length()) {
                val row = rows.getJSONObject(i)
                add(Drama(row.getString("id"), row.value("title"), row.value("synopsis"), row.value("genre"), row.optional("cover_url")))
            }
        }
    }

    suspend fun episodes(dramaId: String): List<DramaEpisode> {
        val path = "ai_drama_episodes?select=id,episode_number,title,synopsis,video_url,thumbnail_url,video_owner" +
            "&drama_id=eq.$dramaId&status=eq.published&order=sort_order.asc,episode_number.asc"
        val rows = JSONArray(get(path))
        return buildList {
            for (i in 0 until rows.length()) {
                val row = rows.getJSONObject(i)
                val videoUrl = row.value("video_url").trim()
                // The Android app disables cleartext traffic; reject non-HTTPS media
                // here so an incorrectly configured Studio episode cannot break playback.
                if (!videoUrl.startsWith("https://", ignoreCase = true)) continue
                add(
                    DramaEpisode(
                        id = row.getString("id"),
                        number = row.optInt("episode_number"),
                        title = row.value("title"),
                        synopsis = row.value("synopsis"),
                        videoUrl = videoUrl,
                        thumbnailUrl = row.optional("thumbnail_url"),
                        videoOwner = row.optional("video_owner")
                    )
                )
            }
        }
    }
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme(
                colorScheme = darkColorScheme(
                    primary = NexoraGold,
                    secondary = NexoraGold,
                    background = NexoraBlack,
                    surface = NexoraPanel,
                    onPrimary = NexoraBlack,
                    onBackground = Color.White,
                    onSurface = Color.White
                )
            ) { NexoraApp() }
        }
    }
}

@Composable
private fun NexoraApp() {
    var dramas by remember { mutableStateOf<List<Drama>>(emptyList()) }
    var episodes by remember { mutableStateOf<List<DramaEpisode>>(emptyList()) }
    var selectedDrama by remember { mutableStateOf<Drama?>(null) }
    var selectedEpisode by remember { mutableStateOf<DramaEpisode?>(null) }
    var loading by remember { mutableStateOf(true) }
    var episodeLoading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var search by remember { mutableStateOf("") }
    var refreshKey by remember { mutableIntStateOf(0) }

    LaunchedEffect(refreshKey) {
        loading = true
        error = null
        try {
            dramas = DramaApi.dramas()
        } catch (e: Exception) {
            error = e.message ?: "Unable to load dramas."
        } finally {
            loading = false
        }
    }

    LaunchedEffect(selectedDrama?.id) {
        val drama = selectedDrama
        if (drama == null) {
            episodes = emptyList()
        } else {
            episodeLoading = true
            error = null
            try {
                episodes = DramaApi.episodes(drama.id)
            } catch (e: Exception) {
                error = e.message ?: "Unable to load episodes."
            } finally {
                episodeLoading = false
            }
        }
    }

    BackHandler(enabled = selectedEpisode != null || selectedDrama != null) {
        if (selectedEpisode != null) selectedEpisode = null else selectedDrama = null
    }

    Column(
        Modifier.fillMaxSize().background(NexoraBlack).statusBarsPadding().navigationBarsPadding()
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            if (selectedDrama != null || selectedEpisode != null) {
                IconButton(onClick = {
                    if (selectedEpisode != null) selectedEpisode = null else selectedDrama = null
                }) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = NexoraGold)
                }
            } else {
                Box(
                    Modifier.size(40.dp).clip(RoundedCornerShape(12.dp)).background(NexoraPanel),
                    contentAlignment = Alignment.Center
                ) { Text("N", color = NexoraGold, fontSize = 25.sp, fontWeight = FontWeight.Black) }
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text("NEXORA", color = Color.White, fontWeight = FontWeight.Black, letterSpacing = 3.sp)
                Text("AI DRAMA", color = NexoraGold, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 2.sp)
            }
            if (selectedDrama == null && selectedEpisode == null) {
                IconButton(onClick = { refreshKey++ }) {
                    Icon(Icons.Default.Refresh, contentDescription = "Refresh", tint = NexoraGold)
                }
            }
        }

        when {
            selectedEpisode != null -> PlayerScreen(selectedEpisode!!)
            selectedDrama != null -> DramaDetailsScreen(
                drama = selectedDrama!!,
                episodes = episodes,
                loading = episodeLoading,
                error = error,
                onPlay = { selectedEpisode = it }
            )
            else -> HomeScreen(
                dramas = dramas,
                loading = loading,
                error = error,
                search = search,
                onSearch = { search = it },
                onSelect = { selectedDrama = it },
                onRetry = { refreshKey++ }
            )
        }
    }
}

@Composable
private fun HomeScreen(
    dramas: List<Drama>,
    loading: Boolean,
    error: String?,
    search: String,
    onSearch: (String) -> Unit,
    onSelect: (Drama) -> Unit,
    onRetry: () -> Unit
) {
    val filtered = dramas.filter {
        it.title.contains(search, true) || it.genre.contains(search, true)
    }
    Column(Modifier.fillMaxSize()) {
        Column(Modifier.padding(horizontal = 20.dp, vertical = 8.dp)) {
            Text("Stories worth staying for.", color = Color.White, fontSize = 27.sp, fontWeight = FontWeight.Bold)
            Text("Discover dramas published by NEXORA STUDIO.", color = NexoraMuted, fontSize = 13.sp)
            Spacer(Modifier.height(16.dp))
            OutlinedTextField(
                value = search,
                onValueChange = onSearch,
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                placeholder = { Text("Search dramas or genres…") },
                shape = RoundedCornerShape(14.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = NexoraGold,
                    unfocusedBorderColor = Color(0xFF343640),
                    focusedTextColor = Color.White,
                    unfocusedTextColor = Color.White,
                    cursorColor = NexoraGold
                )
            )
        }
        when {
            loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = NexoraGold)
            }
            error != null -> EmptyState("Unable to connect", error, "Try again", onRetry)
            filtered.isEmpty() -> EmptyState(
                if (dramas.isEmpty()) "No dramas published yet" else "No matching dramas",
                if (dramas.isEmpty()) "When a title is published in NEXORA STUDIO, it will appear here." else "Try a different title or genre.",
                "Refresh",
                onRetry
            )
            else -> LazyVerticalGrid(
                columns = GridCells.Fixed(2),
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                items(filtered, key = { it.id }) { drama -> DramaCard(drama) { onSelect(drama) } }
            }
        }
    }
}

@Composable
private fun DramaCard(drama: Drama, onClick: () -> Unit) {
    Card(
        onClick = onClick,
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(containerColor = NexoraPanel)
    ) {
        Column {
            Box(Modifier.fillMaxWidth().height(218.dp).background(Color(0xFF22242B))) {
                AsyncImage(
                    model = drama.coverUrl,
                    contentDescription = drama.title,
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.Crop
                )
            }
            Column(Modifier.padding(12.dp)) {
                Text(drama.title, color = Color.White, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (drama.genre.isNotBlank()) {
                    Spacer(Modifier.height(5.dp))
                    Text(drama.genre.uppercase(), color = NexoraGold, fontSize = 10.sp, letterSpacing = 1.sp)
                }
            }
        }
    }
}

@Composable
private fun DramaDetailsScreen(
    drama: Drama,
    episodes: List<DramaEpisode>,
    loading: Boolean,
    error: String?,
    onPlay: (DramaEpisode) -> Unit
) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 28.dp)) {
        item {
            Box(Modifier.fillMaxWidth().height(300.dp).background(NexoraPanel)) {
                AsyncImage(
                    model = drama.coverUrl,
                    contentDescription = drama.title,
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.Crop
                )
            }
            Column(Modifier.padding(horizontal = 20.dp, vertical = 18.dp)) {
                if (drama.genre.isNotBlank()) {
                    Text(drama.genre.uppercase(), color = NexoraGold, fontSize = 11.sp, letterSpacing = 1.5.sp)
                    Spacer(Modifier.height(7.dp))
                }
                Text(drama.title, color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(10.dp))
                Text(
                    drama.synopsis.ifBlank { "Watch the published episodes of this NEXORA original drama." },
                    color = NexoraMuted,
                    fontSize = 14.sp,
                    lineHeight = 21.sp
                )
                Spacer(Modifier.height(24.dp))
                Text("EPISODES", color = Color.White, fontWeight = FontWeight.Bold, letterSpacing = 1.5.sp)
                Spacer(Modifier.height(10.dp))
            }
        }
        when {
            loading -> item {
                Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = NexoraGold)
                }
            }
            error != null -> item {
                Text(error, color = Color(0xFFFF8B83), modifier = Modifier.padding(20.dp))
            }
            episodes.isEmpty() -> item {
                Text("No published episodes yet.", color = NexoraMuted, modifier = Modifier.padding(horizontal = 20.dp))
            }
            else -> items(episodes, key = { it.id }) { episode ->
                EpisodeRow(episode) { onPlay(episode) }
            }
        }
    }
}

@Composable
private fun EpisodeRow(episode: DramaEpisode, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 20.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(Modifier.size(width = 112.dp, height = 72.dp).clip(RoundedCornerShape(12.dp)).background(NexoraPanel)) {
            AsyncImage(
                model = episode.thumbnailUrl,
                contentDescription = null,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Crop
            )
        }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text("EPISODE ${episode.number}", color = NexoraGold, fontSize = 10.sp, letterSpacing = 1.sp)
            Text(episode.title, color = Color.White, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
            episode.videoOwner?.takeIf { it.isNotBlank() }?.let {
                Text("By $it", color = NexoraMuted, fontSize = 11.sp)
            }
        }
        Text("▶", color = NexoraGold, fontSize = 18.sp)
    }
}

@Composable
private fun PlayerScreen(episode: DramaEpisode) {
    val context = LocalContext.current
    val exoPlayer = remember(episode.id) {
        ExoPlayer.Builder(context).build().apply {
            setMediaItem(MediaItem.fromUri(episode.videoUrl))
            prepare()
            playWhenReady = true
        }
    }
    DisposableEffect(exoPlayer) { onDispose { exoPlayer.release() } }
    Column(Modifier.fillMaxSize()) {
        AndroidView(
            factory = { PlayerView(it).apply { this.player = exoPlayer; useController = true } },
            modifier = Modifier.fillMaxWidth().aspectRatio(16f / 9f)
        )
        Column(Modifier.padding(20.dp)) {
            Text("EPISODE ${episode.number}", color = NexoraGold, fontSize = 11.sp, letterSpacing = 1.5.sp)
            Spacer(Modifier.height(8.dp))
            Text(episode.title, color = Color.White, fontSize = 23.sp, fontWeight = FontWeight.Bold)
            if (episode.synopsis.isNotBlank()) {
                Spacer(Modifier.height(10.dp))
                Text(episode.synopsis, color = NexoraMuted, lineHeight = 21.sp)
            }
            episode.videoOwner?.takeIf { it.isNotBlank() }?.let {
                Spacer(Modifier.height(12.dp))
                Text("Creator: $it", color = NexoraMuted, fontSize = 12.sp)
            }
        }
    }
}

@Composable
private fun EmptyState(title: String, message: String, action: String, onAction: () -> Unit) {
    Box(Modifier.fillMaxSize().padding(28.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(title, color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(8.dp))
            Text(message, color = NexoraMuted, fontSize = 13.sp)
            Spacer(Modifier.height(18.dp))
            Button(
                onClick = onAction,
                colors = ButtonDefaults.buttonColors(containerColor = NexoraGold, contentColor = NexoraBlack)
            ) { Text(action, fontWeight = FontWeight.Bold) }
        }
    }
}
