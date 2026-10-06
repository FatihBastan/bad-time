// bad-time: brings the game browser (argument: its pid) back to the front.
function run(argv) {
  ObjC.import('AppKit')
  var app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(Number(argv[0]))
  if (app.isNil()) return 'missing'
  app.unhide
  app.activateWithOptions(3)
  return 'shown'
}
