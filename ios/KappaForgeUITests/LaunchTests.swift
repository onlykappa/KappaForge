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
        // HTML input[type=search] is exposed as XCUIElementTypeSearchField, not TextField.
        let search = web.searchFields["Search settings"]
        if !search.waitForExistence(timeout: 20) {
            XCTContext.runActivity(named: "Settings accessibility hierarchy") { activity in
                activity.add(XCTAttachment(string: app.debugDescription))
            }
            XCTFail("Settings search field did not appear. Inspect the attached accessibility hierarchy.")
        }
        XCTAssertTrue(web.staticTexts["KappaForge could not start"].exists == false, "App should remain running after opening Settings")
    }
    func testComposerRemainsBelowHeaderWhenKeyboardOpens() {
        let app = XCUIApplication()
        app.launch()
        let web = app.webViews.firstMatch
        XCTAssertTrue(web.waitForExistence(timeout: 15))
        let editor = web.textViews["Message"]
        XCTAssertTrue(editor.waitForExistence(timeout: 15), "Chat composer must expose its text editor")
        editor.tap()
        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.waitForExistence(timeout: 10), "Software keyboard must appear after editor focus")
        XCTAssertGreaterThan(editor.frame.minY, web.frame.minY + 45, "Composer must remain below navigation header")
        XCTAssertLessThanOrEqual(editor.frame.maxY, keyboard.frame.minY + 14, "Composer must not overlap the keyboard")
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "PR97 keyboard open layout"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

}
