import PhotosUI
import UIKit

// Photos and Camera from the + sheet. Since iOS 18.4 the web view hands every file input to the app, which used to
// open Files for all of them; the page now says which tile was tapped and this shows the photo library or the camera.
// Each picked image is saved as a JPEG in the temporary folder and given back to the page like any chosen file.
final class MediaPicker: NSObject, PHPickerViewControllerDelegate, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
    private var completion: (([URL]?) -> Void)?

    func present(_ kind: String, multiple: Bool, from controller: UIViewController, completion: @escaping ([URL]?) -> Void) {
        self.completion = completion
        if kind == "camera", UIImagePickerController.isSourceTypeAvailable(.camera) {
            let camera = UIImagePickerController()
            camera.sourceType = .camera
            camera.delegate = self
            controller.present(camera, animated: true)
            return
        }
        var configuration = PHPickerConfiguration()
        configuration.filter = .images
        configuration.selectionLimit = multiple ? 3 : 1
        let picker = PHPickerViewController(configuration: configuration)
        picker.delegate = self
        controller.present(picker, animated: true)
    }

    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        guard !results.isEmpty else { return finish(nil) }
        var urls = [URL?](repeating: nil, count: results.count)
        let group = DispatchGroup()
        for (index, result) in results.enumerated() where result.itemProvider.canLoadObject(ofClass: UIImage.self) {
            group.enter()
            result.itemProvider.loadObject(ofClass: UIImage.self) { object, _ in
                let url = (object as? UIImage).flatMap { Self.save($0) }
                DispatchQueue.main.async {
                    urls[index] = url
                    group.leave()
                }
            }
        }
        group.notify(queue: .main) { self.finish(urls.compactMap { $0 }) }
    }

    func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
        picker.dismiss(animated: true)
        finish((info[.originalImage] as? UIImage).flatMap { Self.save($0) }.map { [$0] })
    }

    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        picker.dismiss(animated: true)
        finish(nil)
    }

    private func finish(_ urls: [URL]?) {
        let callback = completion
        completion = nil
        callback?(urls?.isEmpty == true ? nil : urls)
    }

    private static func save(_ image: UIImage) -> URL? {
        guard let data = image.jpegData(compressionQuality: 0.9) else { return nil }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("photo-\(UUID().uuidString.prefix(8)).jpg")
        do {
            try data.write(to: url)
            return url
        } catch {
            return nil
        }
    }
}
