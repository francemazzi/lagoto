import SwiftUI

enum MarkdownBlock: Equatable {
    case paragraph(String), code(String, String), table([[String]])
}
enum SafeMarkdown {
    static func blocks(_ source: String) -> [MarkdownBlock] {
        let lines = source.components(separatedBy: "\n")
        var result: [MarkdownBlock] = [], paragraph: [String] = [], code: [String] = []
        var language: String?; var index = 0
        func flush() { if !paragraph.isEmpty { result.append(.paragraph(paragraph.joined(separator: "\n"))); paragraph = [] } }
        func cells(_ line: String) -> [String] {
            var value = line.trimmingCharacters(in: .whitespaces)
            if value.hasPrefix("|") { value.removeFirst() }; if value.hasSuffix("|") { value.removeLast() }
            return value.components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespaces) }
        }
        while index < lines.count {
            let line = lines[index]
            if line.hasPrefix("```") {
                if let active = language { result.append(.code(active, code.joined(separator: "\n"))); code = []; language = nil }
                else { flush(); language = String(line.dropFirst(3)) }
            } else if language != nil { code.append(line) }
            else if index + 1 < lines.count && line.contains("|") && cells(lines[index + 1]).allSatisfy({ $0.range(of: "^:?-{3,}:?$", options: .regularExpression) != nil }) {
                flush(); var rows = [cells(line)]; index += 2
                while index < lines.count && lines[index].contains("|") { rows.append(cells(lines[index])); index += 1 }
                result.append(.table(rows)); continue
            } else if line.isEmpty { flush() } else { paragraph.append(line) }
            index += 1
        }
        if let language { result.append(.code(language, code.joined(separator: "\n"))) }; flush()
        return result
    }
    static func allowed(_ url: URL) -> Bool { ["https", "http"].contains(url.scheme?.lowercased() ?? "") && url.host != nil }
}
struct MarkdownView: View {
    let text: String
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(SafeMarkdown.blocks(text).enumerated()), id: \.offset) { _, block in
                switch block {
                case .paragraph(let value):
                    Text((try? AttributedString(markdown: value, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(value)).textSelection(.enabled)
                case .code(let language, let code):
                    VStack(alignment: .leading, spacing: 8) {
                        if !language.isEmpty { Text(language).font(.caption).foregroundStyle(.secondary) }
                        ScrollView(.horizontal) { Text(code).font(.system(.body, design: .monospaced)).textSelection(.enabled).fixedSize(horizontal: true, vertical: false) }
                    }.padding(12).background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
                case .table(let rows):
                    ScrollView(.horizontal) {
                        Grid(alignment: .leading, horizontalSpacing: 20, verticalSpacing: 8) {
                            ForEach(Array(rows.enumerated()), id: \.offset) { rowIndex, row in
                                GridRow { ForEach(Array(row.enumerated()), id: \.offset) { _, cell in Text((try? AttributedString(markdown: cell, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(cell)).fontWeight(rowIndex == 0 ? .semibold : .regular).textSelection(.enabled) } }
                            }
                        }.padding(12)
                    }.background(.quaternary.opacity(0.3), in: RoundedRectangle(cornerRadius: 8))
                }
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
        .environment(\.openURL, OpenURLAction { url in SafeMarkdown.allowed(url) ? .systemAction : .discarded })
    }
}
