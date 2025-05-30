from flask import Flask
from .views import app

# точка входа для flask run
if __name__ == '__main__':
    app.run(debug=True)
