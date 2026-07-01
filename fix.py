import re

with open('reader.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the start of the duplication
target = """<button id="next-page" class="nav-btn next fade" aria-label="Next">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>"""

idx = content.find(target)
if idx != -1:
    idx += len(target)

    # We want to replace everything after this up to the matching part where LAYER B begins
    target2 = """<!-- LAYER B: RAW TEXT VIEWER (Single-Fetch Gutenberg) -->"""
    idx2 = content.find(target2, idx)

    if idx2 != -1:
        new_content = content[:idx] + "\n                </button>\n            </div>\n\n            " + content[idx2:]
        with open('reader.html', 'w', encoding='utf-8') as f:
            f.write(new_content)
        print("Fixed reader.html duplication!")
    else:
        print("Could not find target2")
else:
    print("Could not find target1")
