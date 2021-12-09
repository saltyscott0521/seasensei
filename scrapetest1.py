import re
import pandas as pd
from bs4 import BeautifulSoup
from selenium import webdriver
import requests

# Function for converting knots to MPH
def knotstomph(knots):
    return knots * 1.150779

# Function for scraping Tampa Ports Data as a text string
def scrapeNOAA():
    URL = 'https://tidesandcurrents.noaa.gov/ports/textscreen.shtml?port=tb'
    page = requests.get(URL)
    soup = BeautifulSoup(page.content, 'html.parser')
    return soup

# Function for calculating and displaying Picnic Island Wind
def KnotsPicnic():
    soup = scrapeNOAA()
    strsoup = str(soup)
    x = strsoup.find('Old')
    y = strsoup.find('kn',x)
    x = str(soup)[x:(y+3)-x]
    #print(x)
    result = re.findall(r'-?\d+\.?\d*', x)
    result = float(result[0])
    display = 'The wind speed at Picnic Island is currently at '+str(result)+' Knots or '+str(round(knotstomph(result),1))+' MPH'
    return display

print(KnotsPicnic())