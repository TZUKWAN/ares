"""Fixed analysis worker. User scripts are invoked only through host-approved native tools."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import platform
import random
import subprocess
import sys


def solve(matrix, target):
    augmented = [list(row) + [target[index]] for index, row in enumerate(matrix)]
    for column in range(len(target)):
        pivot = max(range(column, len(target)), key=lambda row: abs(augmented[row][column]))
        if abs(augmented[pivot][column]) < 1e-12:
            raise ValueError("设计矩阵不可逆，请移除重复变量或使用正的岭回归参数")
        augmented[column], augmented[pivot] = augmented[pivot], augmented[column]
        scale = augmented[column][column]
        augmented[column] = [value / scale for value in augmented[column]]
        for row in range(len(target)):
            if row == column:
                continue
            factor = augmented[row][column]
            augmented[row] = [value - factor * other for value, other in zip(augmented[row], augmented[column])]
    return [row[-1] for row in augmented]


def numeric_rows(rows, columns):
    clean = []
    for index, row in enumerate(rows):
        values = []
        for column in columns:
            value = row.get(column)
            if value is None or isinstance(value, bool) or isinstance(value, str) and not value.strip():
                break
            try:
                value = float(value)
            except (ValueError, TypeError):
                break
            if not math.isfinite(value):
                break
            values.append(value)
        if len(values) == len(columns):
            clean.append((index, values))
    return clean


def regression(rows, spec):
    features, target = spec["features"], spec["target"]
    clean = numeric_rows(rows, features + [target])
    if len(clean) < len(features) + 4:
        raise ValueError("有效数值记录不足，至少需要自变量数量加四条记录")
    random.Random(spec["seed"]).shuffle(clean)
    split = max(1, round(len(clean) * spec["testFraction"]))
    testing, training = clean[:split], clean[split:]
    dimension = len(features) + 1
    matrix = [[0.0] * dimension for _ in range(dimension)]
    response = [0.0] * dimension
    for _, values in training:
        xs, y = [1.0] + values[:-1], values[-1]
        for i in range(dimension):
            response[i] += xs[i] * y
            for j in range(dimension):
                matrix[i][j] += xs[i] * xs[j]
    for i in range(1, dimension):
        matrix[i][i] += spec["ridge"]
    coefficients = solve(matrix, response)
    predictions = []
    for index, values in testing:
        predicted = sum(a * b for a, b in zip(coefficients, [1.0] + values[:-1]))
        predictions.append({"row": index, "actual": values[-1], "predicted": predicted, "residual": values[-1] - predicted})
    squared = sum(row["residual"] ** 2 for row in predictions)
    average = sum(row["actual"] for row in predictions) / len(predictions)
    total = sum((row["actual"] - average) ** 2 for row in predictions)
    return {"metrics": {"rmse": math.sqrt(squared / len(predictions)),
                        "mae": sum(abs(row["residual"]) for row in predictions) / len(predictions),
                        "r2": 1 - squared / total if total > 0 else None,
                        "trainingRows": len(training), "testingRows": len(testing),
                        "excludedRows": len(rows) - len(clean)},
            "coefficients": dict(zip(["intercept"] + features, coefficients)), "plot": predictions[:500]}


def clustering(rows, spec):
    clean = numeric_rows(rows, spec["features"])
    k = spec["clusters"]
    if len(clean) < k:
        raise ValueError("有效数值记录少于聚类数量")
    if len(clean) > 5000:
        raise ValueError("当前聚类每组最多5000条有效记录，请先选择分析样本")
    dimension = len(spec["features"])
    means = [sum(row[1][i] for row in clean) / len(clean) for i in range(dimension)]
    scales = [math.sqrt(sum((row[1][i] - means[i]) ** 2 for row in clean) / len(clean)) or 1 for i in range(dimension)]
    points = [[(values[i] - means[i]) / scales[i] for i in range(dimension)] for _, values in clean]
    centers = [list(row) for row in random.Random(spec["seed"]).sample(points, k)]
    assignments = [-1] * len(points)
    for iteration in range(100):
        updated = [min(range(k), key=lambda i: sum((a - b) ** 2 for a, b in zip(point, centers[i]))) for point in points]
        if updated == assignments:
            break
        assignments = updated
        for cluster in range(k):
            members = [point for point, label in zip(points, assignments) if label == cluster]
            if members:
                centers[cluster] = [sum(point[i] for point in members) / len(members) for i in range(dimension)]
    inertia = sum(sum((a - b) ** 2 for a, b in zip(point, centers[label])) for point, label in zip(points, assignments))
    return {"metrics": {"inertia": inertia, "sampleCount": len(clean), "excludedRows": len(rows) - len(clean), "iterations": iteration + 1},
            "clusters": [{"cluster": index, "count": assignments.count(index),
                          "center": {name: centers[index][i] * scales[i] + means[i] for i, name in enumerate(spec["features"])}} for index in range(k)],
            "plot": [{"row": row[0], "x": row[1][0], "y": row[1][1] if dimension > 1 else 0, "cluster": label}
                     for row, label in list(zip(clean, assignments))[:500]]}


def native(spec_file, expected_hash):
    raw = Path(spec_file).read_bytes()
    if hashlib.sha256(raw).hexdigest() != expected_hash:
        raise ValueError("脚本执行计划已发生变化")
    spec = json.loads(raw)
    for key in ("script", "input", "parameters"):
        if hashlib.sha256(Path(spec[key]["path"]).read_bytes()).hexdigest() != spec[key]["sha256"]:
            raise ValueError("已批准的脚本、数据或参数字节发生变化")
    started = datetime.now(timezone.utc).isoformat()
    output = Path(spec["output"])
    if output.exists():
        raise ValueError("本次脚本已有输出，请先核对原运行结果")
    command = [spec["interpreter"], spec["script"]["path"], "--input", spec["input"]["path"],
               "--params", spec["parameters"]["path"], "--output", str(output)]
    result = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=180, stdin=subprocess.DEVNULL)
    if result.returncode:
        raise ValueError("实际分析脚本退出码 " + str(result.returncode))
    if not output.is_file() or output.stat().st_size > 4 * 1024 * 1024:
        raise ValueError("脚本未返回4MiB以内的分析结果JSON")
    data = json.loads(output.read_text(encoding="utf-8-sig"))
    if not isinstance(data.get("metrics"), dict) or not data["metrics"]:
        raise ValueError("脚本结果缺少metrics对象")
    for key, value in data["metrics"].items():
        if not isinstance(key, str) or not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
            raise ValueError("脚本指标必须为有限数值")
    receipt = {"planId": spec["planId"], "startedAt": started, "finishedAt": datetime.now(timezone.utc).isoformat(),
               "exitCode": result.returncode, "outputSha256": hashlib.sha256(output.read_bytes()).hexdigest(),
               "result": data, "python": platform.python_version()}
    Path(spec["receipt"]).write_text(json.dumps(receipt, ensure_ascii=False, allow_nan=False), encoding="utf8")
    print(json.dumps({"planId": spec["planId"], "exitCode": result.returncode, "metrics": data["metrics"]}, ensure_ascii=False, allow_nan=False))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--native-spec")
    parser.add_argument("--expected-sha")
    args = parser.parse_args()
    if args.native_spec:
        native(args.native_spec, args.expected_sha)
        return
    request = json.load(sys.stdin)
    rows, spec = request["rows"], request["spec"]
    result = regression(rows, spec) if spec["engine"] == "regression" else clustering(rows, spec)
    result.update(python=platform.python_version(), system=platform.system(), engine=spec["engine"])
    print(json.dumps(result, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False))
        raise SystemExit(1)
