from flask import Flask
import scrapetest1 as sc

app = Flask(__name__)
@app.route('/')

def hello():
    return 'Welcome to SeaSensei '+sc.KnotsPicnic()
if __name__ == '__main__':
    app.run()