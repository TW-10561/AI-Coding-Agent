from flask import Flask, request, jsonify
import db_tools

app = Flask(__name__)

@app.route('/tool/execute', methods=['POST'])
def execute_tool():
    data = request.json
    tool_name = data.get('tool_name')
    params = data.get('params', {})

    if tool_name == 'query_database':
        result = db_tools.query_database(params.get('query'))
        return jsonify(result)
    else:
        return jsonify({"error": "Tool not found"}), 404

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)