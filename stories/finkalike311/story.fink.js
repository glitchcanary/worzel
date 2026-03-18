oooOO`

VAR parkingStatus = "in effect"
VAR location = ""
VAR main_menu_visits = 0

-> welcome

=== welcome ===
# AUDIO audio/311welcome.wav
Welcome to City 311 Services.
-> main_menu

=== transfer_to_operator ===
# TRANSFER tel:+13125551234
Transferring you to a 311 operator. Please hold.
-> END

=== main_menu ===
~ main_menu_visits = main_menu_visits + 1
{main_menu_visits == 1:
  For street parking, press 1 or say "street parking". For garbage and recycling, press 2. For water and sewer, press 3. For pothole, press 4. For other services, press 5.
- else:
  Please choose an option: street parking, garbage and recycling, water and sewer, pothole, or other services.
}
* [street parking]
  -> parking
* [garbage and recycling]
  -> garbage
* [water and sewer]
  -> water
* [report a pothole]
  -> pothole
* [other services]
  -> other_services
+ [noinput]
  I didn't hear anything.
  -> main_menu
+ [nomatch]
  That's not a valid option.
  -> main_menu

=== parking ===
Alternate side parking is {parkingStatus} today.
# BREAK 300ms
For street cleaning schedule, press 1. To report an abandoned vehicle, press 2.
* [street cleaning schedule]
  # SUBMIT /311/cleaning-schedule.py choice=1
  Connecting you to the street cleaning schedule.
  -> END
* [report abandoned vehicle]
  -> report_vehicle
+ [noinput]
  I didn't hear a selection.
  -> parking
* [back]
  -> main_menu

=== report_vehicle ===
Please describe the vehicle location and we will file a report.
# COLLECT location
* [location collected]
  # SUBMIT_POST /311/report-vehicle.py location
  Thank you. Your abandoned vehicle report has been filed. You will receive a confirmation by text.
  -> END
+ [noinput]
  I didn't catch that. Let's try again.
  -> report_vehicle

=== pothole ===
Please say the street address of the pothole, or enter the zip code using your keypad.
# GRAMMAR_VOICE /grammars/street-address.grxml
# GRAMMAR_DTMF builtin:dtmf/digits
# COLLECT location
* [location collected]
  # SUBMIT_POST /311/report-pothole.py location
  Thank you. Your pothole report has been submitted. A reference number will be sent by text.
  -> END
+ [noinput]
  I didn't catch that. Let's try again.
  -> pothole

=== garbage ===
Garbage and recycling pickup in your area runs Monday and Thursday. Recycling goes out on Thursdays only. Is there anything else?
* [yes, something else]
  -> main_menu
* [no, that's all]
  Thank you for calling 311. Goodbye.
  -> END

=== water ===
For water main breaks or sewer emergencies, press 1. For billing questions, press 2.
* [water main or sewer emergency]
  # SUBMIT /311/water-emergency.py type=emergency
  Connecting you to our water emergency team now.
  # TRANSFER tel:+13125559999
  -> END
* [billing questions]
  # SUBMIT /311/water-billing.py type=billing
  Our billing department is open Monday through Friday, 8am to 5pm. You can also visit city.gov/water-billing.
  -> END
* [back]
  -> main_menu

=== other_services ===
# REDIRECT /311/general.vxml
For other city services, please visit city.gov/311 or stay on the line.
* [continue]
  -> main_menu



`
