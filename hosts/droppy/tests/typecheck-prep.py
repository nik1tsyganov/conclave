import re, pathlib, sys
root = pathlib.Path(sys.argv[1])
sites = {
 'DroppyCode/UI/Chrome/Popovers.swift': ('closePopoverBox', 'PopoverCloseBox?', 'nil'),
 'DroppyCode/UI/Common/RenderBudget.swift': ('isOnGlassPanel', 'Bool', 'false'),
 'DroppyCode/App/Views/RootView.swift': ('chatColumnIsShown', 'Bool', 'true'),
 'DroppyCode/UI/Markdown/MarkdownView.swift': ('hydraMentionPersonas', '[HydraPersona]', '[]'),
}
for path, (name, type_, default) in sites.items():
    p = root / path; s = p.read_text()
    pat = re.compile(r'^(\s*)@Entry var ' + re.escape(name) + r'.*$', re.M)
    assert len(pat.findall(s)) == 1, path
    key = name[0].upper() + name[1:] + 'Key'
    p.write_text(pat.sub(
        r'\1private struct ' + key + ': EnvironmentKey { nonisolated(unsafe) static let defaultValue: ' + type_ + ' = ' + default + ' }\n'
        r'\1var ' + name + ': ' + type_ + ' {\n'
        r'\1    get { self[' + key + '.self] }\n'
        r'\1    set { self[' + key + '.self] = newValue }\n'
        r'\1}', s))
print('prepared', root)
