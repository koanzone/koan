class ThinkFilter:
    """Incremental, bounded-memory filter. Partial tags never leave the server.

    Qwen thinking templates can prefill <think>, so initial hidden state comes
    from the actual rendered prompt. An unclosed block is discarded at EOF.
    """
    def __init__(self, hidden=False):
        self.depth = int(hidden)
        self.pending = ""

    def feed(self, text):
        self.pending += text
        out = []
        tags = ("<think>", "</think>")
        while self.pending:
            lower = self.pending.lower()
            if lower.startswith(tags[0]):
                # A template-prefilled block may be repeated by the model.
                self.depth = 1
                self.pending = self.pending[len(tags[0]):]
            elif lower.startswith(tags[1]):
                self.depth = 0
                self.pending = self.pending[len(tags[1]):]
            elif any(tag.startswith(lower) for tag in tags):
                break
            else:
                if not self.depth:
                    out.append(self.pending[0])
                self.pending = self.pending[1:]
        return "".join(out)

    def finish(self):
        # Fail closed on an incomplete delimiter or reasoning block.
        self.pending = ""
        return ""
