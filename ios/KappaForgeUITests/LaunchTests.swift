import XCTest

final class LaunchTests: XCTestCase {
    func testBundledInterfaceLaunchAndSettings() {
        let app = XCUIApplication()
        app.launch()
        let web = app.webViews.firstMatch
        // The first launch on a freshly booted simulator renders the bundled interface slowly (about 40s observed in CI).
        XCTAssertTrue(web.waitForExistence(timeout: 60), "Bundled WKWebView must load")
        // Phones: the chat is a pushed view. Back leads to Chats; Settings lives under the More tab.
        let back = web.buttons["Back to Chats"]
        XCTAssertTrue(back.waitForExistence(timeout: 60), "Shared interface back button must render")
        back.tap()
        let more = web.buttons["More"]
        XCTAssertTrue(more.waitForExistence(timeout: 15), "The tab bar must be accessible")
        more.tap()
        let settings = web.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Settings")).firstMatch
        XCTAssertTrue(settings.waitForExistence(timeout: 15), "The More page must list Settings")
        settings.tap()
        // The Settings home contains an accessible search field. Section rows and group headings
        // can be exposed differently by WKWebView accessibility on different simulator runtimes.
        // HTML input[type=search] is exposed as XCUIElementTypeSearchField, not TextField.
        let search = web.searchFields["Search settings"]
        if !search.waitForExistence(timeout: 30) {
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
        let editor = app.textViews["native-composer"]
        XCTAssertTrue(editor.waitForExistence(timeout: 15), "Chat composer must expose its text editor")
        editor.tap()
        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.waitForExistence(timeout: 10), "Software keyboard must appear after editor focus")
        XCTAssertGreaterThan(editor.frame.minY, web.frame.minY + 45, "Composer must remain below navigation header")
        XCTAssertLessThanOrEqual(editor.frame.maxY, keyboard.frame.minY + 14, "Composer must not overlap the keyboard")
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "PR98 keyboard open layout"
        attachment.lifetime = .keepAlways
        add(attachment)
        XCTAssertFalse(app.toolbars.buttons["Done"].exists, "Native composer must not show WebKit's navigation accessory")
        editor.typeText("First line\nSecond line")
        XCTAssertTrue((editor.value as? String ?? "").contains("Second line"))
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(editor.waitForExistence(timeout: 10))
        // Public bridge dismisses when tapping outside the composer.
        web.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3)).tap()
        XCTAssertTrue(keyboard.waitForNonExistence(timeout: 10))
        let closed = XCTAttachment(screenshot: app.screenshot())
        closed.name = "PR98 keyboard closed layout"
        closed.lifetime = .keepAlways
        add(closed)
        for _ in 0..<3 {
            editor.tap()
            XCTAssertTrue(keyboard.waitForExistence(timeout: 10))
            XCTAssertFalse(app.toolbars.buttons["Done"].exists)
            XCTAssertLessThanOrEqual(editor.frame.maxY, keyboard.frame.minY + 14)
            web.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3)).tap()
            XCTAssertTrue(keyboard.waitForNonExistence(timeout: 10))
        }
    }

    func testTaskProgressScreenshotsInNativeSimulator() {
        let app = XCUIApplication()
        for (scenario, tag) in [("queued", "QUEUED"), ("running", "IN PROGRESS"), ("failed", "NEEDS ATTENTION"), ("testing", "TESTING"), ("ready", "READY FOR REVIEW")] {
            app.terminate()
            app.launchEnvironment["KAPPA_PROGRESS_FIXTURE"] = scenario
            app.launch()
            let web = app.webViews.firstMatch
            XCTAssertTrue(web.waitForExistence(timeout: 60))
            let status = web.descendants(matching: .any).matching(NSPredicate(format: "label == %@", tag)).firstMatch
            XCTAssertTrue(status.waitForExistence(timeout: 60), "Native progress scenario must render: " + scenario)
            // Exercise real native input before capture so WebKit and UIKit geometry have settled.
            let editor = app.textViews["native-composer"]
            XCTAssertTrue(editor.waitForExistence(timeout: 15))
            editor.tap()
            XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
            if scenario == "running" {
                let keyboardImage = XCTAttachment(screenshot: app.screenshot())
                keyboardImage.name = "PR104 task card running keyboard (simulator fixture)"
                keyboardImage.lifetime = .keepAlways
                add(keyboardImage)
            }
            web.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)).tap()
            XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 10))
            // Return to the beginning of the card after keyboard-driven scrolling.
            web.swipeDown()
            let image = XCTAttachment(screenshot: app.screenshot())
            image.name = "PR104 task card " + scenario + " (simulator fixture)"
            image.lifetime = .keepAlways
            add(image)
            XCTAssertTrue(app.textViews["native-composer"].exists, "The real native composer remains available")
            if scenario == "running" {
                let findings = web.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Issues found (2)")).firstMatch
                XCTAssertTrue(findings.exists, "Confirmed fixture findings must render alongside the live timeline")
            }
        }
        app.terminate()
    }


    func testRedesignScreenshotsInNativeSimulator() {
        let app = XCUIApplication()
        app.launchEnvironment["KAPPA_PROGRESS_FIXTURE"] = "running"
        app.launch()
        let web = app.webViews.firstMatch
        XCTAssertTrue(web.waitForExistence(timeout: 60))
        func capture(_ name: String) {
            sleep(1)
            let image = XCTAttachment(screenshot: app.screenshot())
            image.name = "PR104 " + name + " (simulator fixture)"
            image.lifetime = .keepAlways
            add(image)
        }
        let back = web.buttons["Back to Chats"]
        XCTAssertTrue(back.waitForExistence(timeout: 60))
        back.tap()
        XCTAssertTrue(web.searchFields["Search conversations"].waitForExistence(timeout: 15), "The Chats list must render")
        capture("chats")
        for (tab, name) in [("Dashboard", "dashboard today"), ("More", "more")] {
            let button = web.buttons[tab]
            XCTAssertTrue(button.waitForExistence(timeout: 15), "Tab must be accessible: " + tab)
            button.tap()
            capture(name)
            if tab == "Dashboard" {
                let pulls = web.buttons["Pull requests"]
                XCTAssertTrue(pulls.waitForExistence(timeout: 15))
                pulls.tap()
                sleep(4)
                capture("dashboard pull requests")
                let picker = web.buttons.matching(NSPredicate(format: "label CONTAINS %@", "onlykappa/")).firstMatch
                XCTAssertTrue(picker.waitForExistence(timeout: 15), "The repository picker must be accessible")
                picker.tap()
                capture("repository picker")
                web.buttons["Close"].firstMatch.tap()
            }
        }
        app.terminate()
    }
}
