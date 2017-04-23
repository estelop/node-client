pipeline {
    agent any
    tools {
        nodejs 'node-v7.9.0'
    }
    stages {
        stage('Build') {
            steps {
                sh 'npm install'
            }
        }
        stage('Test') {
            steps {
                sh 'npm test'
            }
        }
        stage('Bundle') {
            steps {
                zip zipFile: "bundle.zip", archive: true
            }
        }
    }
}