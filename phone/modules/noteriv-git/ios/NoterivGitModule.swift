import ExpoModulesCore
import Foundation

@_silgen_name("noteriv_git_execute")
private func gitExecute(_ request: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>?
@_silgen_name("noteriv_git_free")
private func gitFree(_ response: UnsafeMutablePointer<CChar>)

public class NoterivGitModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NoterivGit")
    AsyncFunction("execute") { (request: String) -> String in
      let object = try JSONSerialization.jsonObject(with: Data(request.utf8)) as? [String: Any]
      guard let path = object?["dir"] as? String else { throw GitError.invalidPath }
      let dir = URL(fileURLWithPath: path).resolvingSymlinksInPath().path
      let roots = [FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0],
                   FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]]
      guard roots.contains(where: { dir.hasPrefix($0.resolvingSymlinksInPath().path + "/") }) else { throw GitError.invalidPath }
      return try request.withCString { input in
        guard let output = gitExecute(input) else { throw GitError.executionFailed }
        defer { gitFree(output) }
        return String(cString: output)
      }
    }
  }
}
private enum GitError: Error { case invalidPath, executionFailed }
