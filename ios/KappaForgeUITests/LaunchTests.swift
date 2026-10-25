import XCTest

final class LaunchTests: XCTestCase {
    func testBundledInterfaceLaunchAndSettings() {
        let app = XCUIApplication()
        app.launch()
        let web = app.webViews.firstMatch
        // The first launch on a freshly booted simulator renders the bundled interface slowly (about 40s observed in CI).
        XCTAssertTrue(web.waitForExistence(timeout: 60), "Bundled WKWebView must load")
        // Phones open on Home with the tab bar; Settings lives under the More tab.
        let more = web.buttons["More"]
        XCTAssertTrue(more.waitForExistence(timeout: 60), "The tab bar must be accessible")
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
        // Phones open on Home; start a new chat from the Chats tab to reach the composer.
        let chatsTab = web.buttons["Chats"]
        XCTAssertTrue(chatsTab.waitForExistence(timeout: 60), "The Chats tab must be accessible")
        chatsTab.tap()
        let newChat = web.buttons["New"]
        XCTAssertTrue(newChat.waitForExistence(timeout: 15), "The Chats list must offer New")
        newChat.tap()
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
            // The card's centre contains live workflow links. Dismiss from its empty left gutter
            // so this keyboard exercise cannot open a sheet that intentionally hides the composer.
            web.coordinate(withNormalizedOffset: CGVector(dx: 0.01, dy: 0.2)).tap()
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


    func testRecoveryEligibilityAndReopenInNativeSimulator() {
        let app = XCUIApplication()
        app.launchEnvironment["KAPPA_PROGRESS_FIXTURE"] = "recovery"
        app.launch()
        let web = app.webViews.firstMatch
        XCTAssertTrue(web.waitForExistence(timeout: 60))
        func status(_ label: String) -> XCUIElement {
            web.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
        }
        XCTAssertTrue(status("WAITING FOR COOLDOWN").waitForExistence(timeout: 60))
        XCTAssertFalse(web.buttons["Retry"].exists, "A future provider cooldown must not offer early retry")
        let advance = web.buttons["Simulate cooldown elapsed"]
        XCTAssertTrue(advance.waitForExistence(timeout: 15))
        advance.tap() // Debug simulator fixture only: the real clock crosses the one-minute boundary in one second.
        XCTAssertTrue(status("WAITING FOR RECOVERY").waitForExistence(timeout: 15))
        XCTAssertTrue(web.buttons["Retry"].waitForExistence(timeout: 15), "The one-minute boundary must reveal Retry without a network update")
        for _ in 0..<3 where !web.buttons["Retry"].isHittable { web.swipeUp() }
        web.buttons["Retry"].tap()
        XCTAssertTrue(app.alerts.firstMatch.waitForExistence(timeout: 5))
        app.alerts.buttons["Continue"].tap()
        XCTAssertTrue(status("RECOVERY REQUESTED").waitForExistence(timeout: 15))
        XCTAssertTrue(status("Fixture retry transport 1").exists, "Real Retry must cross authorize and retry transport exactly once")
        let image = XCTAttachment(screenshot: app.screenshot())
        image.name = "Recovery eligibility (fixture; no inference or task dispatch)"
        image.lifetime = .keepAlways
        add(image)
        // WebKit persists localStorage asynchronously. Force-terminating a foreground app bypasses the normal
        // background lifecycle and can kill the WebContent process before its storage transaction reaches disk.
        // Exercise a real app suspension first, then relaunch to verify durable state rather than an in-memory card.
        XCUIDevice.shared.press(.home)
        XCTAssertTrue(app.wait(for: .runningBackground, timeout: 10), "App enters the normal background lifecycle")
        _ = XCTWaiter.wait(for: [XCTestExpectation(description: "WebKit completes background storage flush")], timeout: 5)
        app.terminate()
        app.launch()
        XCTAssertTrue(web.waitForExistence(timeout: 60))
        XCTAssertTrue(status("RECOVERY REQUESTED").waitForExistence(timeout: 60), "Persisted acknowledgement survives a full app restart")
        XCTAssertFalse(web.buttons["Retry"].exists, "Do not immediately duplicate the accepted recovery request")
        XCTAssertFalse(web.buttons["Simulate cooldown elapsed"].exists, "Relaunch must not reset the saved eligibility")
        app.terminate()
    }

    func testRedesignScreenshotsInNativeSimulator() {
        let app = XCUIApplication()
        app.launchEnvironment["KAPPA_PROGRESS_FIXTURE"] = "running"
        app.launch()
        let web = app.webViews.firstMatch
        XCTAssertTrue(web.waitForExistence(timeout: 60))
        // Segments (aria-pressed) and the picker (aria-haspopup) are not exposed as plain buttons, so match by label.
        func element(_ predicate: NSPredicate) -> XCUIElement { web.descendants(matching: .any).matching(predicate).firstMatch }
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
        let searchButton = web.buttons["Search conversations"]
        XCTAssertTrue(searchButton.waitForExistence(timeout: 15), "The Chats list must render")
        capture("chats")
        searchButton.tap()
        XCTAssertTrue(web.searchFields["Search conversations"].waitForExistence(timeout: 15), "Search must open the conversation search field")
        searchButton.tap()
        for (tab, name) in [("Home", "home"), ("Dashboard", "dashboard today"), ("More", "more")] {
            let button = web.buttons[tab]
            XCTAssertTrue(button.waitForExistence(timeout: 15), "Tab must be accessible: " + tab)
            button.tap()
            capture(name)
            if tab == "Dashboard" {
                let pulls = element(NSPredicate(format: "label == %@", "Pull requests"))
                XCTAssertTrue(pulls.waitForExistence(timeout: 15))
                pulls.tap()
                sleep(4)
                capture("dashboard pull requests")
                let picker = element(NSPredicate(format: "label CONTAINS %@", "onlykappa/"))
                XCTAssertTrue(picker.waitForExistence(timeout: 15), "The repository picker must be accessible")
                picker.tap()
                capture("repository picker")
                let close = element(NSPredicate(format: "label == %@", "Close"))
                XCTAssertTrue(close.waitForExistence(timeout: 15), "The repository sheet must open with a Close button")
                close.tap()
            }
        }
        app.terminate()
    }
}
