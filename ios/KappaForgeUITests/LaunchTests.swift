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
        // The Settings home contains an accessible search field. Section rows and group headings
        // can be exposed differently by WKWebView accessibility on different simulator runtimes.
        let search = web.textFields["Search settings"]
        XCTAssertTrue(search.waitForExistence(timeout: 20), "Settings home should expose its search field")
        XCTAssertTrue(web.staticTexts["KappaForge could not start"].exists == false, "App should remain running after opening Settings")
    }
}
