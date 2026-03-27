import sqlite3

def query_database(query):
    conn = sqlite3.connect('example.db')
    cursor = conn.cursor()
    cursor.execute(query)
    result = cursor.fetchall()
    conn.close()
    return result