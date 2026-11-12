Pod::Spec.new do |s|
  s.name = 'NoterivGit'
  s.version = '0.1.0'
  s.summary = 'Shared libgit2 sync engine for Noteriv'
  s.description = s.summary
  s.license = { :type => 'MIT' }
  s.author = 'Noteriv contributors'
  s.homepage = 'https://github.com/passeride/Noteriv'
  s.platforms = { :ios => '15.1' }
  s.source = { :git => 'https://github.com/passeride/Noteriv.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
  s.vendored_frameworks = 'NoterivGit.xcframework'
  s.frameworks = 'Security', 'SystemConfiguration', 'CoreFoundation'
  s.libraries = 'c++', 'z', 'resolv', 'iconv'
end
