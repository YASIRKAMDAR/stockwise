package app.stockwise.staff

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters

/** Sends jobs saved while offline. Each keeps its idempotency key, so a retry can never record it twice. */
class OutboxWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val store = Store(applicationContext)
        val api = Api(store)
        for (p in store.outbox.filter { it.error == null }) {
            try { api.post("/transactions", p.body, p.key); store.dequeue(p.key) }
            catch (e: OfflineException) { return Result.retry() }
            catch (e: ApiException) {
                if (e.status == 401) return Result.retry()      // signed out: send after the next sign-in
                if (e.status in 400..499) store.markFailed(p.key, e.message) // rejected for good (e.g. not enough stock): shown on the home screen
                else return Result.retry()
            }
        }
        return Result.success()
    }
    companion object {
        fun kick(ctx: Context) {
            val req = OneTimeWorkRequestBuilder<OutboxWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build()
            // WorkManager isn't set up in unit tests; the queue still works, it's just sent on the next real launch.
            runCatching { WorkManager.getInstance(ctx).enqueueUniqueWork("outbox", ExistingWorkPolicy.REPLACE, req) }
        }
    }
}
