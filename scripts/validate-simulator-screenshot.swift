import AppKit
import Foundation

guard CommandLine.arguments.count == 2,
      let image = NSImage(contentsOfFile: CommandLine.arguments[1]),
      let data = image.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: data),
      bitmap.pixelsWide > 100, bitmap.pixelsHigh > 200 else {
    fputs("Missing or invalid simulator screenshot\n", stderr)
    exit(1)
}
var dark = 0
var sampled = 0
for y in stride(from: 0, to: bitmap.pixelsHigh, by: 24) {
    for x in stride(from: 0, to: bitmap.pixelsWide, by: 24) {
        guard let pixel = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB) else { continue }
        sampled += 1
        if (pixel.redComponent + pixel.greenComponent + pixel.blueComponent) / 3 < 0.82 {
            dark += 1
        }
    }
}
let share = sampled > 0 ? Double(dark) / Double(sampled) : 0
print(String(format: "Simulator rendered dark-pixel fraction: %.3f", share))
guard share > 0.12 else {
    fputs("Screenshot is blank, mostly white or app has not rendered\n", stderr)
    exit(1)
}
