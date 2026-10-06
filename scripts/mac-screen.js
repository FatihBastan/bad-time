// bad-time: prints the main screen size as WIDTHxHEIGHT, to center the game window.
function run() {
  ObjC.import('AppKit')
  var f = $.NSScreen.mainScreen.frame.size
  return Math.round(f.width) + 'x' + Math.round(f.height)
}
