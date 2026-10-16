import XCTest

final class LaunchTests: XCTestCase {
    func testBundledInterfaceLaunchAndSettings() {
        let app = XCUIApplication()
        app.launch()
        let web = app.webViews.firstMatch
        XCTAssertTrue(web.waitForExistence(timeout: 15), "Bundled WKWebView must load")
        let navigation = web.buttons["Open navigation"]
        XCTAssertTrue(navigation.waitForExistence(timeout: 15))
        navigation.tap()
        let settings = web.buttons["Open settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 15), "Shared interface settings button must be accessible")
        settings.tap()
        XCTAssertTrue(web.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Usage & Billing")).firstMatch.waitForExistence(timeout: 10))
        XCTAssertTrue(web.staticTexts["A clear view of your assistant."].exists)
        XCTAssertFalse(web.staticTexts["KappaForge could not start"].exists)
    }
}
