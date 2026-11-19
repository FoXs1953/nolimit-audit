"""Public matching and reward rules. Only the trusted evaluator calls score()."""

FINDING_FIELDS = {
    "type", "affected_ids", "claimed_amount_minor", "currency", "evidence_ids", "explanation",
}


def _id(value):
    return isinstance(value, str) and bool(value.strip())


def _canonical(ids):
    # Identifiers are case sensitive. Ordering, surrounding whitespace and repeated
    # entries within an ID list do not change which records were referenced.
    return frozenset(value.strip() for value in ids)


def _invalid(episode_id, submission):
    if not isinstance(submission, dict) or set(submission) != {"episode_id", "findings"}:
        return "invalid_envelope"
    if submission["episode_id"] != episode_id:
        return "wrong_episode"
    findings = submission["findings"]
    if not isinstance(findings, list) or len(findings) > 30:
        return "invalid_findings_list"
    for item in findings:
        if not isinstance(item, dict) or set(item) != FINDING_FIELDS:
            return "invalid_finding_fields"
        if not _id(item["type"]) or type(item["claimed_amount_minor"]) is not int:
            return "invalid_type_or_amount"
        currency = item["currency"]
        if not isinstance(currency, str) or len(currency) != 3 or not (
            currency.isascii() and currency.isalpha() and currency.isupper()
        ):
            return "invalid_currency"
        if not isinstance(item["explanation"], str) or len(item["explanation"]) > 1000:
            return "invalid_explanation"
        for field in ("affected_ids", "evidence_ids"):
            values = item[field]
            if not isinstance(values, list) or not all(_id(value) for value in values):
                return "invalid_id_list"
        if len(item["evidence_ids"]) > 10:
            return "too_many_evidence_ids"
    return None


def _possible_matches(episode, findings, truth):
    public_ids = {
        row[field] for records in episode["tables"].values() for row in records
        for field in ("doc_id", "row_id") if _id(row.get(field))
    }
    normalized_truth = [
        (_canonical(issue["affected_ids"]), [_canonical(ids) for ids in issue["evidence_sets"]])
        for issue in truth
    ]
    candidates = []
    for claim in findings:
        affected = _canonical(claim["affected_ids"])
        evidence = _canonical(claim["evidence_ids"])
        compatible = []
        if evidence and evidence.issubset(public_ids):
            for index, issue in enumerate(truth):
                expected_ids, alternatives = normalized_truth[index]
                delta = abs(claim["claimed_amount_minor"] - issue["expected_amount_minor"])
                if (claim["type"] == issue["type"] and affected == expected_ids
                        and claim["currency"] == issue["currency"]
                        and delta <= issue.get("tolerance_minor", 0)
                        and any(ids and ids.issubset(evidence) for ids in alternatives)):
                    compatible.append(index)
        candidates.append(compatible)
    return candidates


def _maximum_matching(candidates):
    """Augmenting paths. Claim order and sorted issue IDs resolve ties."""
    owner = {}

    def assign(claim, seen):
        for issue in candidates[claim]:
            if issue in seen:
                continue
            seen.add(issue)
            if issue not in owner or assign(owner[issue], seen):
                owner[issue] = claim
                return True
        return False

    for claim in range(len(candidates)):
        assign(claim, set())
    return owner


def score(episode, submission, inspection_steps):
    """Score an envelope. inspection_steps counts all inspections, excluding submit.

    Invalid envelopes return -1 and an evaluator-only error code. For valid envelopes
    a wrong type, wrong amount or unavailable evidence is an unmatched claim (FP).
    No textual justification participates in matching or reward.
    """
    if type(inspection_steps) is not int or inspection_steps < 0:
        raise ValueError("inspection_steps must be a nonnegative integer")
    truth = sorted(episode["truth"], key=lambda issue: issue["issue_id"])
    error = _invalid(episode["manifest"]["episode_id"], submission)
    if error:
        return {"valid": False, "errors": [error], "tp": 0, "fp": 0, "fn": len(truth),
                "precision": 0.0, "recall": 0.0, "f1": 0.0, "reward": -1.0,
                "inspection_steps": inspection_steps, "matches": []}
    findings = submission["findings"]
    assignments = _maximum_matching(_possible_matches(episode, findings, truth))
    matches = [{"finding_index": claim, "issue_id": truth[issue]["issue_id"]}
               for issue, claim in sorted(assignments.items(), key=lambda pair: pair[1])]
    tp = len(matches)
    fp, fn = len(findings) - tp, len(truth) - tp
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * tp / (2 * tp + fp + fn) if tp + fp + fn else 1.0
    reward = max(-1.0, min(1.0, 2 * f1 - 1 - 0.002 * inspection_steps))
    return {"valid": True, "errors": [], "tp": tp, "fp": fp, "fn": fn,
            "precision": precision, "recall": recall, "f1": f1, "reward": reward,
            "inspection_steps": inspection_steps, "matches": matches}
