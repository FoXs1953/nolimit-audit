"""Evaluator process. The private owner pipe and policy action socket are distinct."""
from decimal import Decimal, DecimalException, Subnormal, Underflow, localcontext
import hashlib
import re
import socket
import sys
import threading
import time

from .env import ACTION_LIMIT, decode, decode_action, encode
from .scoring import score

TABLE_KEYS = {"ledger": "row_id", "fx": "row_id", "invoices": "invoice_id", "payments": "payment_id"}
DOCUMENT_TABLES = ("invoices", "payments")
TOOL_FIELDS = {
    "list_records": {"tool", "table", "cursor", "limit"},
    "get_record": {"tool", "table", "id"},
    "get_document": {"tool", "doc_id"},
    "calculator": {"tool", "expression"},
}
PUBLIC_FIELDS = {
    "manifest": "schema_version generator_version episode_id company base_currency timezone period_start period_end currency_exponents rounding record_counts record_count document_count",
    "policy": "policy_version currency_exponents rounding amount_tolerance_minor fx_date rate_direction period document_identity allocation journal",
    "ledger": "row_id timestamp account debit_minor credit_minor currency entity_id invoice_id payment_id journal_id",
    "invoices": "doc_id invoice_id entity_id issued_at due_at currency total_minor source_ref line_items",
    "payments": "doc_id payment_id timestamp currency amount_minor invoice_refs kind",
    "fx": "row_id date source_currency target_currency rate",
    "line_items": "description quantity unit_price_minor amount_minor",
}
PUBLIC_FIELDS = {schema: tuple(fields.split()) for schema, fields in PUBLIC_FIELDS.items()}
NUMBER = re.compile(r"(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)|[()+*/-]")


class ToolError(ValueError):
    pass


def project(schema, record):
    """Select versioned public fields, including nested document fields."""
    result = {}
    for field in PUBLIC_FIELDS[schema]:
        if field not in record:
            continue
        value = record[field]
        if field == "line_items":
            value = [project("line_items", item) for item in value]
        elif field == "invoice_refs":
            value = [ref for ref in value if type(ref) is str or ref is None]
        elif field == "record_counts":
            value = {k: v for k, v in value.items() if k in TABLE_KEYS and type(v) is int}
        elif field == "currency_exponents":
            value = {k: v for k, v in value.items() if re.fullmatch(r"[A-Z]{3}", k) and type(v) is int}
        elif isinstance(value, (dict, list)):
            raise ValueError("Unexpected public field type")
        result[field] = value
    return result


def calculate(expression):
    """Bounded decimal arithmetic. Grammar has sums, products, unary signs and parentheses."""
    if type(expression) is not str or len(expression) > 512 or not expression.isascii():
        raise ToolError("invalid_expression")
    tokens = NUMBER.findall(expression)
    if not tokens or len(tokens) > 100 or "".join(tokens) != "".join(expression.split()):
        raise ToolError("invalid_expression")
    index = 0

    def peek():
        return tokens[index] if index < len(tokens) else None

    def atom():
        nonlocal index
        token = peek()
        index += 1
        if token in ("+", "-"):
            number = atom()
            return -number if token == "-" else number
        if token == "(":
            answer = expr(0)
            if peek() != ")":
                raise ToolError("invalid_expression")
            index += 1
            return answer
        if token is None or token[0] not in ".0123456789" or len(token) > 48:
            raise ToolError("invalid_expression")
        return Decimal(token)

    precedence = {"+": 1, "-": 1, "*": 2, "/": 2}

    def expr(min_precedence):
        nonlocal index
        left = atom()
        while peek() in precedence and precedence[peek()] >= min_precedence:
            operator = peek()
            index += 1
            right = expr(precedence[operator] + 1)
            if operator == "+":
                left += right
            elif operator == "-":
                left -= right
            elif operator == "*":
                left *= right
            else:
                left /= right
        return left

    try:
        with localcontext() as context:
            context.prec = 48
            context.traps[Underflow] = context.traps[Subnormal] = True
            context.Emax, context.Emin = 128, -128
            result = expr(0)
            if index != len(tokens) or not result.is_finite():
                raise ToolError("invalid_expression")
            value = format(result, "f")
            if "." in value:
                value = value.rstrip("0").rstrip(".")
            return "0" if result.is_zero() else value
    except DecimalException:
        raise ToolError("invalid_expression") from None


class Evaluator:
    def __init__(self, mode, budget, seconds):
        self.mode = mode
        self.budget = budget
        self.seconds = seconds
        self.episode = None
        self.trace = []
        self.report = None

    def reset(self, episode):
        manifest = project("manifest", episode["manifest"])
        policy = project("policy", episode["policy"])
        tables = {table: [project(table, row) for row in episode["tables"][table]] for table in TABLE_KEYS}
        indexes, documents = {}, {}
        for table, rows in tables.items():
            indexes[table] = {}
            for row in rows:
                indexes[table][row[TABLE_KEYS[table]]] = row
                if table in DOCUMENT_TABLES:
                    documents[row["doc_id"]] = row
                    indexes[table][row["doc_id"]] = row
        self.episode, self.eid = episode, manifest["episode_id"]
        self.tables, self.indexes, self.documents = tables, indexes, documents
        self.steps = self.inspections = 0
        self.cursors, self.trace, self.report = {}, [], None
        self.started = time.monotonic()
        self.terminated = self.truncated = False
        return [{"task": "Проверьте период компании и отправьте выводы с доказательствами.",
                 "manifest": manifest, "policy": policy, "remaining_steps": self.budget}, {}]

    def page(self, action):
        table = action.get("table")
        if type(table) is not str or table not in TABLE_KEYS:
            raise ToolError("unknown_table")
        limit, cursor = action.get("limit", 50), action.get("cursor")
        if type(limit) is not int or not 1 <= limit <= 50:
            raise ToolError("invalid_limit")
        offset = 0
        if cursor is not None:
            position = self.cursors.get(cursor) if type(cursor) is str else None
            if not position or position[0] != table:
                raise ToolError("invalid_cursor")
            offset = position[1]
        end = offset + limit
        rows = self.tables[table]
        following = None
        if end < len(rows):
            following = hashlib.sha256(encode([self.eid, table, end])).hexdigest()[:24]
            self.cursors[following] = (table, end)
        return {"records": rows[offset:end], "next_cursor": following}

    def inspect(self, action):
        if not isinstance(action, dict):
            raise ToolError("invalid_action")
        tool = action.get("tool")
        if type(tool) is not str or tool not in TOOL_FIELDS or not action.keys() <= TOOL_FIELDS[tool]:
            raise ToolError("invalid_action")
        if tool == "list_records":
            return self.page(action)
        if tool == "calculator":
            return {"value": calculate(action.get("expression"))}
        if tool == "get_document":
            key, records = action.get("doc_id"), self.documents
        else:
            table = action.get("table")
            if type(table) is not str or table not in TABLE_KEYS:
                raise ToolError("unknown_table")
            key, records = action.get("id"), self.indexes[table]
        if type(key) is not str or key not in records:
            raise ToolError("unknown_id")
        return records[key]

    def finish(self, submission, reason):
        self.terminated, self.truncated = reason == "submit", reason != "submit"
        # Stop the policy clock before private matching or later report retrieval.
        elapsed = min(time.monotonic() - self.started, self.seconds)
        self.report = score(self.episode, submission, self.inspections)
        self.report.update(episode_id=self.eid, steps=self.steps, terminated=self.terminated,
                           truncated=self.truncated, reason=reason, elapsed_seconds=elapsed,
                           submission=submission)

    def observe(self, data, reward=0.0):
        return [{**data, "remaining_steps": self.budget-self.steps}, reward, self.terminated, self.truncated, {}]

    def terminal_reward(self):
        return self.report["reward"] if self.mode == "train" else 0.0

    def truncate(self, reason, pending=None):
        if reason not in ("time_limit", "step_limit", "peer_closed"):
            raise ValueError("unknown terminal reason")
        if self.episode is None:
            raise ValueError("reset required")
        if self.report is not None:
            return self.observe({"error": "already_done"})
        self.finish({"episode_id": self.eid, "findings": []}, reason)
        result = self.observe({"result": {"reason": reason}}, self.terminal_reward())
        self.record(pending, result)
        return result

    def record(self, action, output):
        obs, reward, terminated, truncated, _ = output
        # Without a final action an idle timeout/disconnect is a separate terminal event.
        # It receives a unique sequence index and consumes no inspection budget.
        self.trace.append({"episode_id": self.eid, "step": len(self.trace) + 1, "action": action,
                           "observation": obs, "reward": reward, "terminated": terminated,
                           "truncated": truncated})

    def expired(self):
        return self.episode is not None and time.monotonic() - self.started >= self.seconds

    def step(self, action):
        if self.episode is None:
            return [{"error":"reset_required", "remaining_steps":0}, 0.0, False, False, {}]
        if self.report is not None:
            return self.observe({"error": "already_done"})
        if self.expired():
            return self.truncate("time_limit")
        self.steps += 1
        if isinstance(action, dict) and action.get("tool") == "submit":
            submission = action.get("findings") if set(action) == {"tool", "findings"} else None
            self.finish(submission, "submit")
            outcome = self.observe({"result": {"submitted": True}}, self.terminal_reward())
        else:
            self.inspections += 1
            try:
                result = {"result": self.inspect(action)}
            except ToolError as exc:
                result = {"error": str(exc)}
            if self.expired():
                return self.truncate("time_limit", action)
            if self.steps >= self.budget:
                return self.truncate("step_limit", action)
            outcome = self.observe(result)
        self.record(action, outcome)
        return outcome

    def owner(self, command):
        op = command["op"]
        if op == "generate":
            from .generator import generate
            return self.reset(generate(command["seed"], command["config"]))
        if op == "reset_episode":
            return self.reset(command["episode"])
        if op == "truncate":
            return self.truncate(command["reason"])
        if op not in ("report", "trajectory"):
            raise ValueError("unknown owner operation")
        if self.report is None and self.expired():
            self.truncate("time_limit")
        return self.report if op == "report" else self.trace


def action_server(evaluator, sock, lock):
    with sock, sock.makefile("rb") as reader:
        while True:
            line = reader.readline(ACTION_LIMIT + 1)
            if not line:
                return
            if len(line) > ACTION_LIMIT:
                while line and not line.endswith(b"\n"):
                    line = reader.readline(ACTION_LIMIT + 1)
                action = None
            else:
                action = decode_action(line)
            with lock:
                answer = evaluator.step(action)
            try:
                sock.sendall(encode(answer))
            except OSError:
                return


def main():
    sock = socket.socket(fileno=int(sys.argv[1]))
    evaluator = Evaluator(sys.argv[2], int(sys.argv[3]), float(sys.argv[4]))
    lock = threading.Lock()
    threading.Thread(target=action_server, args=(evaluator, sock, lock), daemon=True).start()
    for line in sys.stdin.buffer:
        try:
            command = decode(line)
            with lock:
                result = evaluator.owner(command)
            answer = {"ok": result}
        except (ValueError, KeyError, TypeError, OverflowError) as exc:
            # Owner-only input diagnostics. Never sent through the action socket.
            answer = {"error": str(exc)}
        sys.stdout.buffer.write(encode(answer))
        sys.stdout.buffer.flush()


if __name__ == "__main__":
    main()
