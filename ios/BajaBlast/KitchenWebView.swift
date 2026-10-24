import SwiftUI
import WebKit

/// The kitchen's phone page, full screen.
///
/// Its own storage on the phone (WKWebsiteDataStore.default) is kept between
/// launches, which is where "Who are you?" is remembered. Pull down to
/// refresh. If the kitchen stops answering — the phone left the Wi-Fi — the
/// app goes back to finding it rather than showing an error page.
struct KitchenWebView: UIViewRepresentable {
    let url: URL
    let onLost: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onLost: onLost) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        let view = WKWebView(frame: .zero, configuration: config)
        view.isOpaque = false
        view.backgroundColor = .black
        view.scrollView.backgroundColor = .black
        view.allowsBackForwardNavigationGestures = true
        view.navigationDelegate = context.coordinator

        let refresh = UIRefreshControl()
        refresh.tintColor = .white
        refresh.addTarget(context.coordinator, action: #selector(Coordinator.refresh(_:)), for: .valueChanged)
        view.scrollView.refreshControl = refresh
        context.coordinator.webView = view

        view.load(URLRequest(url: url))
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        weak var webView: WKWebView?
        let onLost: () -> Void

        init(onLost: @escaping () -> Void) { self.onLost = onLost }

        @objc func refresh(_ control: UIRefreshControl) {
            webView?.reload()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { control.endRefreshing() }
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            onLost()
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            if (error as NSError).code != NSURLErrorCancelled { onLost() }
        }

        /// Links to anywhere but the kitchen open in Safari, not in the app.
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if let target = action.request.url, let here = webView.url,
               target.host != here.host, action.navigationType == .linkActivated {
                UIApplication.shared.open(target)
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }
    }
}
