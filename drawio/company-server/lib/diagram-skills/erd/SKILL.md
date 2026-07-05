# ER 图生成规则

## 适用场景
用于关系型数据模型、表结构、主键、外键和实体关系。

## 输出规则
- 实体名使用数据库表名风格。用户给出表名时，优先保持原名，例如 `employees`、`files`、`folders`。
- 每个实体都应包含主键字段，除非用户明确表示没有主键。
- 主键字段设置 `pk=true`。
- 外键字段设置 `fk=true`，名称要清楚，例如 `employee_id`、`folder_id`。
- 关系连接实体，不连接字段。
- 关系基数使用 `one-to-many`、`many-to-one`、`one-to-one` 或 `many-to-many`。
- 字段文本保持简短，只写字段名和类型。
- 每个实体通常不超过 12 个字段，除非用户要求完整字段。

## 禁止事项
- 不要把行为、方法、流程步骤放进 ER 实体。
- 不要把字段名全部塞进关系标签。
- 不要生成过长字段文本。
- 不要要求渲染器使用 draw.io 的 `tableRow` 自动布局。
- 不要让字段文本旋转或竖排。

## 输出结构
输出 `entities` 和 `relations`。

实体示例：`{ "id": "files", "name": "files", "columns": [{ "name": "id", "type": "uuid", "pk": true }, { "name": "employee_id", "type": "string", "fk": true }] }`

关系示例：`{ "from": "files", "to": "employees", "label": "owned by", "cardinality": "many-to-one" }`
