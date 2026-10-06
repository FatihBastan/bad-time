// bad-time: prints the pid of the app in front, so the fight runs only while the game is.
function run() {
  ObjC.import('AppKit')
  return $.NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier
}
