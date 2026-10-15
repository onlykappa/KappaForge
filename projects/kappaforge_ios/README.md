# KappaForge iOS Prototype

## Setup
1. Open `KappaForge.xcodeproj` (or create a new SwiftUI project in Xcode).
2. Copy these files into the project structure.
3. Build for iOS 17+.

## Architecture
- Models: Typed structs for UI state.
- Views: SwiftUI modular components.
- Mock Data: Provided in `Models.swift` for UI development.

## Next Steps
1. Implement `URLSession` service layer for GitHub REST API.
2. Add OAuth2 flow using `ASWebAuthenticationSession`.
3. Integrate `SwiftData` for local caching of repository metadata.