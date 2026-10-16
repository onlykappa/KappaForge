import AppKit
import Foundation

let path = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "ios/KappaForge/Assets.xcassets/AppIcon.appiconset"
try FileManager.default.createDirectory(atPath: path, withIntermediateDirectories: true)
let size = 1024
let image = NSImage(size: NSSize(width: size, height: size), flipped: false) { rect in
    NSColor(calibratedRed: 0.329, green: 0.337, blue: 0.725, alpha: 1).setFill()
    NSBezierPath(rect: rect).fill()
    let star = NSBezierPath()
    let points: [(CGFloat, CGFloat)] = [(512,123),(587,405),(880,512),(587,608),(512,901),(421,608),(144,512),(421,405)]
    star.move(to: NSPoint(x: points[0].0, y: points[0].1))
    for p in points.dropFirst() { star.line(to: NSPoint(x: p.0, y: p.1)) }
    star.close()
    NSColor.white.setFill()
    star.fill()
    NSColor(calibratedRed: 0.851, green: 0.843, blue: 1, alpha: 1).setFill()
    NSBezierPath(ovalIn: NSRect(x: 720, y: 737, width: 86, height: 86)).fill()
    return true
}
guard let tiff = image.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: tiff),
      let png = bitmap.representation(using: .png, properties: [:]) else {
    fatalError("Could not render icon")
}
try png.write(to: URL(fileURLWithPath: path + "/Icon.png"))
let info = #"{"images":[{"filename":"Icon.png","idiom":"universal","platform":"ios","size":"1024x1024"}],"info":{"author":"xcode","version":1}}"#
try info.write(toFile: path + "/Contents.json", atomically: true, encoding: .utf8)
