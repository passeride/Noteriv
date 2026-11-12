package expo.modules.noterivgit

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager
import android.util.Base64

object NativeGit {
  init { System.loadLibrary("noteriv_git") }
  @JvmStatic external fun execute(request: String): String
  @JvmStatic external fun initialize(caFile: String): Boolean
  var ready = false
}
class NoterivGitModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NoterivGit")
    AsyncFunction("execute") { request: String ->
      val context = appContext.reactContext ?: error("Application context unavailable")
      val json = JSONObject(request)
      val dir = File(json.getString("dir")).canonicalFile
      val root = context.filesDir.canonicalFile
      require(dir.path.startsWith(root.path + File.separator)) { "Git directory must be inside app storage" }
      synchronized(NativeGit) {
        if (!NativeGit.ready) {
          val factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
          factory.init(null as KeyStore?)
          val roots = factory.trustManagers.filterIsInstance<X509TrustManager>().flatMap { it.acceptedIssuers.toList() }
          require(roots.isNotEmpty()) { "No trusted CA certificates are available" }
          val file = File(context.filesDir, "noteriv-git-ca.pem")
          file.writeText(roots.joinToString("\n") { cert -> "-----BEGIN CERTIFICATE-----\n" + Base64.encodeToString(cert.encoded, Base64.NO_WRAP).chunked(64).joinToString("\n") + "\n-----END CERTIFICATE-----\n" })
          require(NativeGit.initialize(file.absolutePath)) { "Cannot initialize TLS certificate validation" }
          NativeGit.ready = true
        }
      }
      NativeGit.execute(request)
    }
  }
}
