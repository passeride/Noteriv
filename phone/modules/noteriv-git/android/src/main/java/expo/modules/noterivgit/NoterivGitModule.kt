package expo.modules.noterivgit

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager

object NativeGit {
  init { System.loadLibrary("noteriv_git") }
  @JvmStatic external fun execute(request: String): String
  @JvmStatic external fun initialize(roots: Array<ByteArray>): String?
  var ready = false
}
class NoterivGitModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NoterivGit")
    Events("onPluginShortcut")
    OnStartObserving("onPluginShortcut") {
      NoterivPluginKeys.listener = { binding -> sendEvent("onPluginShortcut", mapOf("binding" to binding)) }
    }
    OnStopObserving("onPluginShortcut") {
      NoterivPluginKeys.listener = null
      NoterivPluginKeys.bindings = emptySet()
    }
    Function("setPluginShortcuts") { bindings: List<String> ->
      NoterivPluginKeys.bindings = bindings.toSet()
    }
    AsyncFunction("execute") { request: String ->
      val context = appContext.reactContext ?: error("Application context unavailable")
      val json = JSONObject(request)
      val dir = File(json.getString("dir")).canonicalFile
      val root = context.filesDir.canonicalFile
      require(dir.path.startsWith(root.path + File.separator)) { "Git directory must be inside app storage" }
      synchronized(NativeGit) {
        if (!NativeGit.ready && json.optString("action") != "pluginVault") {
          val factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
          factory.init(null as KeyStore?)
          val roots = factory.trustManagers.filterIsInstance<X509TrustManager>().flatMap { it.acceptedIssuers.toList() }
          require(roots.isNotEmpty()) { "No trusted CA certificates are available" }
          val failure = NativeGit.initialize(roots.distinct().map { it.encoded }.toTypedArray())
          check(failure == null) { "Cannot initialize Git TLS: $failure" }
          NativeGit.ready = true
        }
      }
      NativeGit.execute(request)
    }
  }
}
